import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getExactWorkspaceModel } from "@/lib/ai/provider";
import { openAiRun, recordRunOutcome, type AiRunHandle, type OpenRunInput } from "@/lib/ai/run";
import { checkSpendLimits, type SpendCheck } from "@/lib/ai/spend";
import { logAudit } from "@/lib/audit";
import { findWaitingSession } from "@/lib/flow-engine/engine";
import { createNotificationOnce } from "@/lib/notifications/create";
import { AGENT_CRON_TICK_SECONDS, type AgentBurstPayload } from "@/lib/scheduler";
import { loadWorkspaceAgents, resolveAgentState, type AgentConfig } from "./config";
import {
  countAgentReplies,
  exchangeStart,
  extractBurst,
  lastHumanReplyAt,
  loadContactContext,
  loadRecentMessages,
  loadTurnConversation,
  toHistory,
  type StoredMessage,
  type TurnConversation,
} from "./context";
import { clearAgentError, markAgentError, type AgentErrorKind } from "./errors";
import { escalateToHuman } from "./escalate";
import {
  generateWithFallback,
  toolLoopRunner,
  type ModelResolver,
  type ModelRunner,
} from "./fallback";
import { evaluateGuardrails } from "./guardrails";
import { validateOutput } from "./output";
import { buildModelMessages, buildSystemPrompt } from "./prompt";
import { defaultSend, sendAgentParts, type SendFn } from "./send";
import { buildToolSet } from "./tools/build";
import { newNonce } from "./untrusted";

/**
 * Un turno del agente conversacional (F22): toma la rafaga de mensajes del
 * lead y la responde una sola vez. Un turno = un run.
 *
 * El orden es el que garantiza "un solo respondedor por mensaje" y "todo lo
 * barato antes de tocar un proveedor":
 *
 *   1. Idempotencia: si no hay rafaga sin responder, no hay turno.
 *   2. Ventana de silencio: se espera a que cierre (el job llega un tic antes).
 *      Si en la espera llego un mensaje mas, ya hay otro turno agendado: este
 *      se retira sin run.
 *   3. Palancas y coexistencia, re-verificadas: la decision del receptor tiene
 *      mas de un minuto. Si un flow reclamo la conversacion, una persona
 *      respondio o alguien apago el agente, el agente se abstiene y lo deja
 *      escrito.
 *   4. Guardarrailes (temas vedados, enojo, urgencia, horario, topes de
 *      respuestas) y topes de gasto. Ninguno llama al modelo.
 *   5. El modelo, con reintento y respaldo, y las herramientas.
 *   6. Formato validado en codigo.
 *   7. Espera hasta el objetivo (ultimo mensaje + ventana + demora). Si el lead
 *      escribe durante la espera, se envia ya.
 *   8. Ultimo chequeo (nadie tomo la conversacion mientras se generaba), envio,
 *      cierre del run.
 *
 * Toda salida deja su run, salvo las que no son un turno (no habia nada que
 * responder, o otro turno ya se hizo cargo).
 */

type Db = SupabaseClient<Database>;

/** Presupuesto de la invocacion: la ruta tiene maxDuration 300 s. */
export const TURN_BUDGET_MS = 280_000;
/** Un turno cuya ventana cerro hace mas que esto se descarta: responder tarde es peor. */
export const STALE_TURN_MS = 3 * 60_000;
const WAIT_POLL_MS = 2_000;

export interface TurnDeps {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  resolveModel: (workspaceId: string) => ModelResolver;
  runModel: ModelRunner;
  send: SendFn;
  checkSpend: typeof checkSpendLimits;
}

export const defaultTurnDeps: TurnDeps = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  resolveModel: (workspaceId) => (provider, model) => getExactWorkspaceModel(workspaceId, { provider, modelId: model }),
  runModel: toolLoopRunner,
  send: defaultSend,
  checkSpend: checkSpendLimits,
};

export type TurnOutcome =
  | { kind: "no_turn"; reason: "no_conversation" | "nothing_to_answer" | "superseded" | "window_open" }
  | { kind: "run"; status: string; detail: string | null; runId: string | null };

function parsePayload(raw: unknown): AgentBurstPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const need = ["workspaceId", "conversationId", "channelId", "contactId", "agentId"] as const;
  if (!need.every((k) => typeof p[k] === "string" && p[k])) return null;
  return p as unknown as AgentBurstPayload;
}

export async function runAgentTurn(
  supabase: Db,
  rawPayload: unknown,
  deps: TurnDeps = defaultTurnDeps,
): Promise<TurnOutcome> {
  const startedAt = deps.now().getTime();
  const payload = parsePayload(rawPayload);
  if (!payload) return { kind: "no_turn", reason: "no_conversation" };

  const conversation = await loadTurnConversation(supabase, payload.conversationId);
  if (!conversation || conversation.deleted_at) return { kind: "no_turn", reason: "no_conversation" };

  const runBase: OpenRunInput = {
    workspaceId: conversation.workspace_id,
    source: "agent",
    trigger: "inbound_message",
    conversationId: conversation.id,
    contactId: conversation.contact_id,
    channelId: conversation.channel_id,
    agentId: payload.agentId,
  };

  // 1. Idempotencia: la rafaga sin responder.
  let messages = await loadRecentMessages(supabase, conversation.id);
  let burst = extractBurst(messages);
  if (burst.length === 0) return { kind: "no_turn", reason: "nothing_to_answer" };

  const agents = await loadWorkspaceAgents(supabase, conversation.workspace_id);
  const agentForRun = agents.find((a) => a.id === payload.agentId) ?? null;
  const tick = AGENT_CRON_TICK_SECONDS * 1000;

  // 2. La ventana de silencio.
  const deadlineAt = payload.burst_deadline ? new Date(payload.burst_deadline).getTime() + tick : Infinity;
  const windowEndFor = (lastInbound: StoredMessage, agent: AgentConfig | null) =>
    Math.min(new Date(lastInbound.created_at).getTime() + (agent?.bundleWindowSeconds ?? 60) * 1000, deadlineAt);

  let lastInbound = burst[burst.length - 1];
  let windowEnd = windowEndFor(lastInbound, agentForRun);
  const nowMs = deps.now().getTime();

  if (nowMs - windowEnd > STALE_TURN_MS) {
    return await discardStale(supabase, { runBase, conversation, agent: agentForRun, now: deps.now() });
  }
  if (windowEnd - nowMs > tick + 5_000) {
    // Se levanto demasiado temprano (un mensaje reprogramo la ventana despues
    // de que el job ya estaba reclamado): el webhook de ese mensaje ya agendo
    // otro turno, que es el que va a responder.
    return { kind: "no_turn", reason: "window_open" };
  }
  if (windowEnd > nowMs) {
    await deps.sleep(windowEnd - nowMs);
    messages = await loadRecentMessages(supabase, conversation.id);
    burst = extractBurst(messages);
    if (burst.length === 0) return { kind: "no_turn", reason: "nothing_to_answer" };
    const newest = burst[burst.length - 1];
    if (newest.id !== lastInbound.id) return { kind: "no_turn", reason: "superseded" };
    lastInbound = newest;
    windowEnd = windowEndFor(lastInbound, agentForRun);
  }

  // 3. Palancas, re-verificadas.
  const fresh = (await loadTurnConversation(supabase, conversation.id)) ?? conversation;
  const state = resolveAgentState({
    agents,
    channelId: fresh.channel_id,
    conversation: fresh,
    now: deps.now(),
  });
  if (state.state !== "active") {
    // Hubo un turno agendado, asi que alguien esperaba que el agente actuara:
    // la abstencion deja rastro (por ejemplo, una persona respondio y el
    // toggle se apago mientras corria la ventana).
    const runId = await recordRunOutcome(supabase, { ...runBase, status: "skipped", statusDetail: state.state });
    return { kind: "run", status: "skipped", detail: state.state, runId };
  }
  const agent = state.agent;
  runBase.agentId = agent.id;
  runBase.promptVersion = agent.promptVersion;

  // Coexistencia. Si un flow o una persona ya respondieron, la rafaga quedo
  // cerrada por esa salida y el turno ya se retiro arriba (nada que responder).
  // Lo que queda por mirar es un flow esperando la respuesta del lead.
  const waitingFlow = await findWaitingSession(supabase, {
    contactId: fresh.contact_id,
    channelId: fresh.channel_id,
  });
  if (waitingFlow) {
    const runId = await recordRunOutcome(supabase, { ...runBase, status: "skipped_automation", statusDetail: "flow_session" });
    return { kind: "run", status: "skipped_automation", detail: "flow_session", runId };
  }

  // Desde aca hay turno de verdad: se abre el run.
  const run = await openAiRun(supabase, { ...runBase, provider: agent.provider, model: agent.model }, () => deps.now());

  try {
    return await continueTurn(supabase, { deps, agent, conversation: fresh, messages, burst, windowEnd, run, startedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    console.error("[agent-turn] el turno fallo:", message);
    await run.close({ status: "error", statusDetail: "turn_exception", error: message });
    await markAgentError(supabase, {
      workspaceId: fresh.workspace_id,
      conversationId: fresh.id,
      runId: run.runId,
      kind: "turn_error",
      assignedTo: fresh.assigned_to,
      now: deps.now(),
    });
    return { kind: "run", status: "error", detail: "turn_exception", runId: run.runId };
  }
}

async function continueTurn(
  supabase: Db,
  args: {
    deps: TurnDeps;
    agent: AgentConfig;
    conversation: TurnConversation;
    messages: StoredMessage[];
    burst: StoredMessage[];
    windowEnd: number;
    run: AiRunHandle;
    startedAt: number;
  },
): Promise<TurnOutcome> {
  const { deps, agent, conversation, messages, burst, run } = args;
  const runId = run.runId;
  const close = async (status: Parameters<AiRunHandle["close"]>[0]["status"], detail: string | null, error?: string) => {
    await run.close({ status, statusDetail: detail, error: error ?? null });
    return { kind: "run" as const, status, detail, runId };
  };

  // 4. Guardarrailes, sin modelo.
  const burstText = burst.map((m) => m.text ?? "").join("\n");
  const humanAt = await lastHumanReplyAt(supabase, conversation.id);
  const repliesSinceHuman = await countAgentReplies(supabase, { conversationId: conversation.id, since: humanAt });
  const exchangeFrom = exchangeStart(messages, agent.guardrails.escalation.exchangeGapMinutes);
  const unresolvedSince = latestOf(humanAt, exchangeFrom);
  const unresolvedTurns = await countAgentReplies(supabase, { conversationId: conversation.id, since: unresolvedSince });

  const block = evaluateGuardrails({
    guardrails: agent.guardrails,
    burstText,
    now: deps.now(),
    repliesSinceHuman,
    maxRepliesPerConversation: agent.maxRepliesPerConversation,
    unresolvedTurns,
  });

  if (block) {
    await run.step({ kind: "guardrail", name: block.kind, output: { accion: block.action, detalle: block.detail } });
    if (block.action === "escalate") {
      await escalateToHuman(supabase, {
        workspaceId: conversation.workspace_id,
        conversationId: conversation.id,
        contactId: conversation.contact_id,
        channelId: conversation.channel_id,
        agentId: agent.id,
        runId,
        reason: `Guardarrail: ${block.detail}`,
        origin: "guardrail",
        reopen: true,
      });
      return close("escalated", `guardrail:${block.kind}`);
    }
    if (block.action === "notice") {
      const recentAgentReply = messages.some(
        (m) => m.direction === "outbound" && m.sent_by_agent_id && deps.now().getTime() - new Date(m.created_at).getTime() < 8 * 3_600_000,
      );
      if (!recentAgentReply) {
        const notice = validateOutput(agent.guardrails.businessHours.outsideMessage, agent.outputFormat);
        if (notice.ok) {
          const result = await sendAgentParts(supabase, sendCtx(conversation, agent, runId), notice.parts.slice(0, 1), deps.send);
          if (result.sent > 0) return close("blocked_guardrail", "guardrail:outside_hours_notice");
        }
      }
    }
    return close("blocked_guardrail", `guardrail:${block.kind}`);
  }

  // Topes de gasto, ANTES de la llamada.
  const spend = await deps.checkSpend(supabase, {
    workspaceId: conversation.workspace_id,
    agentId: agent.id,
    limits: await spendLimitsFor(supabase, agent),
    now: deps.now(),
  });
  await handleSpendWarnings(supabase, agent, spend);
  if (!spend.allowed) {
    if (spend.blocking === null) {
      await markAgentError(supabase, {
        workspaceId: conversation.workspace_id,
        conversationId: conversation.id,
        runId,
        kind: "turn_error",
        assignedTo: conversation.assigned_to,
        now: deps.now(),
      });
      return close("error", "spend_check_failed", "No se pudo verificar el gasto de IA antes de llamar al modelo.");
    }
    await disableForSpend(supabase, agent, spend.blocking.scope);
    await run.step({ kind: "guardrail", name: "spend_limit", output: spend.blocking });
    // Tope alcanzado: el lead no puede quedar sin nadie. Pasa a una persona.
    await escalateToHuman(supabase, {
      workspaceId: conversation.workspace_id,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      channelId: conversation.channel_id,
      agentId: agent.id,
      runId,
      reason: "Se alcanzo el tope de gasto de IA",
      origin: "guardrail",
      reopen: true,
    });
    return close("blocked_guardrail", `spend:${spend.blocking.scope}`);
  }

  // 5. El modelo.
  const nonce = newNonce();
  const [contact, toolSet] = await Promise.all([
    loadContactContext(supabase, conversation.contact_id),
    buildToolSet({
      supabase,
      agent,
      workspaceId: conversation.workspace_id,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      channelId: conversation.channel_id,
      run,
      nonce,
    }),
  ]);
  const system = buildSystemPrompt(agent, nonce, Object.keys(toolSet.tools));
  const modelMessages = buildModelMessages({ history: toHistory(messages), contact, nonce });

  const generation = await generateWithFallback({
    candidates: [
      { provider: agent.provider, model: agent.model, role: "primary" },
      { provider: agent.fallbackProvider, model: agent.fallbackModel, role: "fallback" },
    ],
    resolve: deps.resolveModel(conversation.workspace_id),
    runModel: deps.runModel,
    buildInput: () => ({
      system,
      messages: modelMessages,
      tools: toolSet.tools,
      temperature: agent.temperature ?? undefined,
      maxOutputTokens: agent.maxOutputTokens ?? undefined,
      onStep: async (step) => {
        run.addStepUsage(step.usage);
        await run.step({
          kind: "model_call",
          name: "paso",
          output: { finishReason: step.finishReason, herramientas: step.toolNames },
        });
      },
    }),
    timeoutMs: agent.modelTimeoutSeconds * 1000,
    deadline: args.startedAt + TURN_BUDGET_MS - agent.responseDelaySeconds * 1000,
    now: () => deps.now().getTime(),
    run,
  });

  if (toolSet.state.escalated) {
    // El agente decidio derivar: el turno termina sin responder. Si despues de
    // derivar el modelo fallo, igual quedo derivado, que es lo que importa.
    if (generation.ok) run.setFinalUsage(generation.output.totalUsage);
    return close("escalated", "tool:derivar_a_humano");
  }

  if (!generation.ok) {
    const kind: AgentErrorKind = generation.reason === "model_timeout" ? "model_timeout" : "provider_unavailable";
    await escalateToHuman(supabase, {
      workspaceId: conversation.workspace_id,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      channelId: conversation.channel_id,
      agentId: agent.id,
      runId,
      reason: kind === "model_timeout" ? "El modelo no respondio a tiempo" : "Fallaron el modelo principal y el de respaldo",
      origin: "provider_failure",
      reopen: true,
    });
    await markAgentError(supabase, {
      workspaceId: conversation.workspace_id,
      conversationId: conversation.id,
      runId,
      kind,
      assignedTo: conversation.assigned_to,
      now: deps.now(),
    });
    return close("escalated", kind, generation.attempts.map((a) => `${a.role}: ${a.problem}`).join("; "));
  }

  run.setFinalUsage(generation.output.totalUsage);
  run.setModel(generation.provider, generation.model);
  const modelDetail = generation.role === "fallback" ? "fallback_model" : null;

  // 6. Formato, en codigo.
  const output = validateOutput(generation.output.text, agent.outputFormat);
  if (!output.ok) {
    await run.step({ kind: "guardrail", name: "output_format", error: output.reason });
    await escalateToHuman(supabase, {
      workspaceId: conversation.workspace_id,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      channelId: conversation.channel_id,
      agentId: agent.id,
      runId,
      reason: output.reason === "empty" ? "El agente no genero una respuesta" : "La respuesta del agente no paso la validacion",
      origin: "guardrail",
      reopen: true,
    });
    return close("escalated", `output:${output.reason}`);
  }

  // 7. Espera hasta el objetivo.
  const target = args.windowEnd + agent.responseDelaySeconds * 1000;
  const lastBurstId = burst[burst.length - 1].id;
  const interrupted = await waitUntilTarget(supabase, deps, conversation.id, target, lastBurstId);

  // 8. Nadie tomo la conversacion mientras se generaba.
  const latest = await loadTurnConversation(supabase, conversation.id);
  const humanAfter = await lastHumanReplyAt(supabase, conversation.id);
  if (!latest || !latest.agent_enabled || (humanAfter && isAfter(humanAfter, burst[0].created_at))) {
    return close("skipped", "human_took_over_during_generation");
  }
  const waiting = await findWaitingSession(supabase, {
    contactId: conversation.contact_id,
    channelId: conversation.channel_id,
  });
  if (waiting) return close("skipped_automation", "flow_session_during_generation");

  const sent = await sendAgentParts(supabase, sendCtx(latest, agent, runId), output.parts, deps.send);
  if (sent.sent === 0) {
    await markAgentError(supabase, {
      workspaceId: conversation.workspace_id,
      conversationId: conversation.id,
      runId,
      kind: "turn_error",
      assignedTo: conversation.assigned_to,
      now: deps.now(),
    });
    return close("error", "send_failed", sent.failure?.message ?? "No se pudo enviar la respuesta.");
  }

  await clearAgentError(supabase, conversation.id);
  const details = [
    modelDetail,
    output.truncated ? "output_truncated" : null,
    sent.failure ? `partial_send:${sent.sent}/${output.parts.length}` : null,
    interrupted ? "sent_early_new_message" : null,
  ].filter(Boolean);
  return close("responded", details.length ? details.join(",") : null);
}

const ms = (iso: string) => new Date(iso).getTime();
const isAfter = (a: string, b: string) => ms(a) > ms(b);

function latestOf(...values: Array<string | null>): string | null {
  return values.filter((v): v is string => Boolean(v)).sort((a, b) => ms(a) - ms(b)).at(-1) ?? null;
}

function sendCtx(conversation: TurnConversation, agent: AgentConfig, runId: string | null) {
  return {
    workspaceId: conversation.workspace_id,
    channelId: conversation.channel_id,
    contactId: conversation.contact_id,
    conversationId: conversation.id,
    lateConversationId: conversation.late_conversation_id,
    agentId: agent.id,
    runId,
  };
}

/**
 * Espera hasta el objetivo de envio. Si el lead escribe durante la espera, se
 * sale antes: la respuesta sigue valiendo para lo que pregunto, y esperar de
 * mas solo la amontona con el turno siguiente. Devuelve si se interrumpio.
 */
export async function waitUntilTarget(
  supabase: Db,
  deps: Pick<TurnDeps, "now" | "sleep">,
  conversationId: string,
  target: number,
  lastBurstId: string,
): Promise<boolean> {
  while (deps.now().getTime() < target) {
    await deps.sleep(Math.min(WAIT_POLL_MS, target - deps.now().getTime()));
    const recent = await loadRecentMessages(supabase, conversationId, 3);
    const newestInbound = [...recent].reverse().find((m) => m.direction === "inbound");
    if (newestInbound && newestInbound.id !== lastBurstId) return true;
  }
  return false;
}

async function discardStale(
  supabase: Db,
  args: { runBase: OpenRunInput; conversation: TurnConversation; agent: AgentConfig | null; now: Date },
): Promise<TurnOutcome> {
  const runId = await recordRunOutcome(supabase, {
    ...args.runBase,
    status: "error",
    statusDetail: "job_expired",
    error: "El turno se descarto: la ventana de silencio habia cerrado hace demasiado.",
  });
  await markAgentError(supabase, {
    workspaceId: args.conversation.workspace_id,
    conversationId: args.conversation.id,
    runId,
    kind: "job_expired",
    assignedTo: args.conversation.assigned_to,
    now: args.now,
  });
  return { kind: "run", status: "error", detail: "job_expired", runId };
}

async function spendLimitsFor(supabase: Db, agent: AgentConfig) {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("ai_daily_cost_limit_usd, ai_monthly_cost_limit_usd")
    .eq("id", agent.workspaceId)
    .maybeSingle();
  return {
    agentDailyUsd: agent.dailyCostLimitUsd,
    agentDailyAction: agent.dailyCostLimitAction,
    agentMonthlyUsd: agent.monthlyCostLimitUsd,
    agentMonthlyAction: agent.monthlyCostLimitAction,
    workspaceDailyUsd: workspace?.ai_daily_cost_limit_usd === null || workspace?.ai_daily_cost_limit_usd === undefined ? null : Number(workspace.ai_daily_cost_limit_usd),
    workspaceMonthlyUsd: workspace?.ai_monthly_cost_limit_usd === null || workspace?.ai_monthly_cost_limit_usd === undefined ? null : Number(workspace.ai_monthly_cost_limit_usd),
  };
}

const SCOPE_LABELS: Record<string, string> = {
  agent_daily: "diario del agente",
  agent_monthly: "mensual del agente",
  workspace_daily: "diario de IA del workspace",
  workspace_monthly: "mensual de IA del workspace",
};

async function handleSpendWarnings(supabase: Db, agent: AgentConfig, spend: SpendCheck): Promise<void> {
  for (const warning of spend.warnings) {
    await createNotificationOnce({
      supabase,
      workspaceId: agent.workspaceId,
      type: "agent_spend_limit",
      title: `Se alcanzo el tope ${SCOPE_LABELS[warning.scope]}`,
      body: `Gastado: USD ${warning.spentUsd.toFixed(2)} de USD ${warning.limitUsd.toFixed(2)} (estimado segun los precios cargados). El agente sigue respondiendo.`,
      metadata: { agent_id: agent.id, scope: warning.scope },
      withinMinutes: 12 * 60,
    });
  }
}

/** Un tope con accion "disable": se apaga el agente, queda auditado y se avisa. */
async function disableForSpend(supabase: Db, agent: AgentConfig, scope: string): Promise<void> {
  const { error } = await supabase.from("agents").update({ is_enabled: false }).eq("id", agent.id).eq("is_enabled", true);
  if (error) console.error("[agent-spend] no pude apagar el agente:", error.message);
  await logAudit({
    supabase,
    workspaceId: agent.workspaceId,
    entityType: "agent",
    entityId: agent.id,
    action: "update",
    changes: { is_enabled: { old: true, new: false } },
    metadata: { reason: "spend_limit", scope },
    performedByAgentId: agent.id,
  });
  await createNotificationOnce({
    supabase,
    workspaceId: agent.workspaceId,
    type: "agent_spend_limit",
    title: `Se apago el agente: tope ${SCOPE_LABELS[scope] ?? scope}`,
    body: "Las conversaciones nuevas pasan a una persona. Se vuelve a encender desde Agentes.",
    metadata: { agent_id: agent.id, scope, disabled: true },
    withinMinutes: 12 * 60,
  });
}
