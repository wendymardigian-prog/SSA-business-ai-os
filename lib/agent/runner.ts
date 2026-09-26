import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getExactWorkspaceModel } from "@/lib/ai/provider";
import { openAiRun, recordRunOutcome, type AiRunHandle, type OpenRunInput } from "@/lib/ai/run";
import { checkSpendLimits, type SpendCheck } from "@/lib/ai/spend";
import { logAudit } from "@/lib/audit";
import { findWaitingSession } from "@/lib/flow-engine/engine";
import { createNotificationOnce } from "@/lib/notifications/create";
import {
  AGENT_BURST_JOB,
  AGENT_BURST_VOLATILE_KEYS,
  AGENT_CRON_TICK_SECONDS,
  agentBurstKey,
  pushDebouncedJob,
  type AgentBurstPayload,
} from "@/lib/scheduler";
import { DEFAULT_BURST_MAX_AGE_HOURS, channelMode, loadWorkspaceAgents, resolveAgentState, type AgentConfig } from "./config";
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
import { createDraft, type CreateDraftInput } from "./drafts/create";
import { parseAppliedActions, type AppliedAction, type SuggestedAction } from "./drafts/types";
import { evaluateGuardrails, isWithinBusinessHours } from "./guardrails";
import { validateOutput } from "./output";
import { buildModelMessages, buildSystemPrompt, type DraftRevision } from "./prompt";
import { defaultSend, sendAgentParts, type SendFn } from "./send";
import { defaultRefresh, type RefreshFn } from "./refresh";
import { alreadyAnsweredSince, claimAgentReply, lastExternalOutboundAt, withinExternalCooldown } from "./reply-check";
import { evaluateRules, type RuleEvalResult } from "./rules/evaluate";
import { buildPreRuleContext, fillResponseContext } from "./rules/context";
import { validateIntent } from "./tools/declare-intent";
import type { RuleAction } from "./rules/fields";
import { buildToolSet } from "./tools/build";
import { newNonce } from "./untrusted";
import type { AgentChannelMode } from "@/lib/types/database";

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
 *
 * Modo borrador (Bloque 2c): si el canal esta en "draft", todo lo anterior es
 * identico salvo el final. En vez de enviar, el turno deja la respuesta en
 * agent_drafts y el run cierra `drafted`. Sin demora deliberada (no hay nadie
 * del otro lado esperando que parezca humano), sin horario de atencion (si hay
 * una persona para aprobar, no esta fuera de horario), y lo que en envio
 * directo deriva (un guardarrail, un fallo del proveedor) deja una fila sin
 * texto con el motivo: la cola es el unico lugar donde vive "lo que necesita
 * una respuesta". El borrador NO es un mensaje: no cierra la rafaga.
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
  /** Refresco contra Zernio antes de verificar (F5). Inyectable en los tests. */
  refresh: RefreshFn;
}

export const defaultTurnDeps: TurnDeps = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  resolveModel: (workspaceId) => (provider, model) => getExactWorkspaceModel(workspaceId, { provider, modelId: model }),
  runModel: toolLoopRunner,
  send: defaultSend,
  checkSpend: checkSpendLimits,
  refresh: defaultRefresh,
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

  // Regenerar un borrador (Bloque 2c): el turno responde la misma rafaga del
  // borrador anterior, sin esperar ventana ni descartarse por viejo.
  const previousDraft = payload.regenerate_of
    ? await loadPreviousDraft(supabase, payload.regenerate_of, conversation.id)
    : null;

  const runBase: OpenRunInput = {
    workspaceId: conversation.workspace_id,
    source: "agent",
    trigger: previousDraft ? "manual" : "inbound_message",
    conversationId: conversation.id,
    contactId: conversation.contact_id,
    channelId: conversation.channel_id,
    agentId: payload.agentId,
  };

  const agents = await loadWorkspaceAgents(supabase, conversation.workspace_id);
  const agentForRun = agents.find((a) => a.id === payload.agentId) ?? null;
  const tick = AGENT_CRON_TICK_SECONDS * 1000;

  // 1. Idempotencia: la rafaga sin responder. Los entrantes mas viejos que
  // burst_max_age_hours no se responden (siguen en el contexto).
  const burstOf = (msgs: StoredMessage[]) =>
    previousDraft?.burst_started_at
      ? // Regenerar: lo mismo que respondia el borrador anterior (mas lo que el
        // lead haya escrito despues), sin el corte por antiguedad.
        extractBurst(msgs).filter((m) => ms(m.created_at) >= ms(previousDraft.burst_started_at as string))
      : extractBurst(msgs, {
          maxAgeMs: (agentForRun?.burstMaxAgeHours ?? DEFAULT_BURST_MAX_AGE_HOURS) * 3_600_000,
          now: deps.now(),
        });
  let messages = await loadRecentMessages(supabase, conversation.id);
  let burst = burstOf(messages);
  if (burst.length === 0) return { kind: "no_turn", reason: "nothing_to_answer" };

  // 2. La ventana de silencio.
  const deadlineAt = payload.burst_deadline ? new Date(payload.burst_deadline).getTime() + tick : Infinity;
  const windowEndFor = (lastInbound: StoredMessage, agent: AgentConfig | null) =>
    Math.min(new Date(lastInbound.created_at).getTime() + (agent?.bundleWindowSeconds ?? 60) * 1000, deadlineAt);

  let lastInbound = burst[burst.length - 1];
  let windowEnd = windowEndFor(lastInbound, agentForRun);
  const nowMs = deps.now().getTime();

  // Una regeneracion sin mensajes nuevos no espera ventana: la pidio una
  // persona ahora. Si el lead escribio despues del borrador, es un turno
  // normal (con la cadena enlazada) y la instruccion ya no vale.
  const newerThanPrevious =
    previousDraft !== null && ms(lastInbound.created_at) > ms(previousDraft.burst_last_inbound_at ?? lastInbound.created_at);
  const skipWindow = previousDraft !== null && !newerThanPrevious;

  if (skipWindow) {
    windowEnd = nowMs;
  } else if (nowMs - windowEnd > STALE_TURN_MS && !payload.blocked_retry) {
    return await discardStale(supabase, { runBase, conversation, agent: agentForRun, now: deps.now() });
  }
  if (!skipWindow && windowEnd - nowMs > tick + 5_000) {
    // Se levanto demasiado temprano (un mensaje reprogramo la ventana despues
    // de que el job ya estaba reclamado): el webhook de ese mensaje ya agendo
    // otro turno, que es el que va a responder.
    return { kind: "no_turn", reason: "window_open" };
  }
  if (!skipWindow && windowEnd > nowMs) {
    await deps.sleep(windowEnd - nowMs);
    messages = await loadRecentMessages(supabase, conversation.id);
    burst = burstOf(messages);
    if (burst.length === 0) return { kind: "no_turn", reason: "nothing_to_answer" };
    const newest = burst[burst.length - 1];
    if (newest.id !== lastInbound.id) return { kind: "no_turn", reason: "superseded" };
    lastInbound = newest;
    windowEnd = windowEndFor(lastInbound, agentForRun);
  }

  runBase.inboundAt = lastInbound.created_at;

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

  // 3. Verificación antes de responder (F5, momento 1). Zernio no avisa por
  // webhook lo que se manda desde ManyChat o la app de Instagram, así que
  // primero se refresca el historial y recién después se mira si ya hubo una
  // respuesta. Un saliente posterior al inbound (venga de donde venga) retira
  // el turno sin llamar al modelo.
  const refresh1 = await deps.refresh(supabase, {
    conversationId: fresh.id,
    workspaceId: fresh.workspace_id,
    channelId: fresh.channel_id,
    lateConversationId: fresh.late_conversation_id,
    sinceIso: burst[0].created_at,
    runId: null,
  });
  if (refresh1.inserted > 0) {
    messages = await loadRecentMessages(supabase, fresh.id);
  }
  if (await alreadyAnsweredSince(supabase, { conversationId: fresh.id, inboundAt: lastInbound.created_at })) {
    const runId = await recordRunOutcome(supabase, {
      ...runBase,
      status: "already_answered",
      routing: { check: "already_answered", moment: 1, refresh: refresh1.ok ? "ok" : "failed" },
    });
    return { kind: "run", status: "already_answered", detail: "moment_1", runId };
  }

  // 4. Espera tras respuesta externa (F7). Si otra herramienta (ManyChat)
  // respondió hace menos de N minutos, el agente no se mete.
  if (
    withinExternalCooldown({
      lastInboundAt: lastInbound.created_at,
      lastExternalAt: await lastExternalOutboundAt(supabase, fresh.id),
      cooldownMinutes: agent.externalReplyCooldownMinutes,
    })
  ) {
    const runId = await recordRunOutcome(supabase, {
      ...runBase,
      status: "skipped",
      statusDetail: "external_cooldown",
      routing: { check: "external_cooldown" },
    });
    return { kind: "run", status: "skipped", detail: "external_cooldown", runId };
  }

  // Una regeneracion siempre deja borrador, aunque el canal haya vuelto a
  // envio directo en el medio: nadie pidio que salga sin revisar.
  const mode = previousDraft ? "draft" : channelMode(agent, fresh.channel_id);
  const revision: TurnRevision | null = previousDraft
    ? {
        previousDraftId: previousDraft.id,
        previousBody: previousDraft.body,
        instruction: skipWindow ? (payload.regenerate_instruction?.trim() || null) : null,
        alreadyApplied: parseAppliedActions(previousDraft.applied_actions).map((a) => a.label),
      }
    : null;

  // Desde aca hay turno de verdad: se abre el run.
  const run = await openAiRun(supabase, { ...runBase, provider: agent.provider, model: agent.model }, () => deps.now());

  try {
    return await continueTurn(supabase, {
      deps,
      agent,
      conversation: fresh,
      messages,
      burst,
      windowEnd,
      run,
      startedAt,
      mode,
      revision,
      payload,
      // Regenerar sin mensajes nuevos reescribe el texto: no vuelve a tocar el
      // CRM (Bloque 2d-A). Con un mensaje nuevo del lead es un turno normal.
      readOnlyTools: previousDraft !== null && skipWindow,
    });
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
    mode: AgentChannelMode;
    revision: TurnRevision | null;
    payload: AgentBurstPayload;
    readOnlyTools: boolean;
  },
): Promise<TurnOutcome> {
  const { deps, agent, conversation, messages, burst, run } = args;
  const runId = run.runId;
  const rulesMode = args.mode === "rules";
  // En modo "rules" el turno decide al final entre enviar y dejar borrador; hasta
  // entonces no es "draft" (genera igual). draftMode es sólo el modo borrador puro.
  let draftMode = args.mode === "draft";
  const close = async (status: Parameters<AiRunHandle["close"]>[0]["status"], detail: string | null, error?: string) => {
    await run.close({ status, statusDetail: detail, error: error ?? null });
    return { kind: "run" as const, status, detail, runId };
  };
  const joinDetails = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(",") || null;
  const routingFor = (mode: string, r: RuleEvalResult, stage: "before" | "after", refresh?: string) => ({
    mode,
    rule_id: r.ruleId,
    rule_index: r.ruleIndex,
    action: r.action,
    matched: r.matched,
    stage,
    evaluated_at: deps.now().toISOString(),
    ...(refresh ? { refresh } : {}),
  });

  // En modo borrador el horario de atencion no aplica: si hay una persona para
  // aprobar, no esta fuera de horario. Queda anotado en el run.
  const outsideHoursNote = draftMode && !isWithinBusinessHours(agent.guardrails, deps.now()) ? "outside_hours" : null;

  /**
   * Termina el turno dejando el borrador (modo borrador). Si otro borrador de
   * la conversacion esta saliendo en este instante, no es un error: el turno
   * se reprograma y el reintento responde la rafaga completa.
   */
  const leaveDraft = async (
    draft: Pick<CreateDraftInput, "body" | "bodyParts" | "noReplyReason" | "suggestedActions" | "appliedActions">,
    detail: string | null,
    error?: string,
  ): Promise<TurnOutcome> => {
    const result = await createDraft(supabase, {
      ...draft,
      workspaceId: conversation.workspace_id,
      agentId: agent.id,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      channelId: conversation.channel_id,
      runId,
      burst: burst.map((m) => ({ id: m.id, created_at: m.created_at })),
      previousDraftId: args.revision?.previousDraftId ?? null,
      regenerateInstruction: args.revision?.instruction ?? null,
    });
    if (result.kind === "blocked_by_in_flight_send") {
      await rescheduleBlockedTurn(supabase, { deps, conversation, agent, burst });
      return close("skipped", "draft_blocked_by_send");
    }
    if (result.kind === "failed") return close("error", "draft_insert_failed", result.message);
    if (result.kind === "created") await clearAgentError(supabase, conversation.id);
    return close("drafted", joinDetails(detail, outsideHoursNote, result.kind === "superseded_on_create" && "superseded_on_create"), error);
  };
  const escalateSuggestion = (reason: string): SuggestedAction => ({ type: "escalate", reason, summary: null, reopen: true });

  // 4. Guardarrailes, sin modelo.
  const burstText = burst.map((m) => m.text ?? "").join("\n");
  const humanAt = await lastHumanReplyAt(supabase, conversation.id);
  const repliesSinceHuman = await countAgentReplies(supabase, { conversationId: conversation.id, since: humanAt });
  const exchangeFrom = exchangeStart(messages, agent.guardrails.escalation.exchangeGapMinutes);
  const unresolvedSince = latestOf(humanAt, exchangeFrom);
  const unresolvedTurns = await countAgentReplies(supabase, { conversationId: conversation.id, since: unresolvedSince });

  const block = evaluateGuardrails({
    guardrails: draftMode
      ? { ...agent.guardrails, businessHours: { ...agent.guardrails.businessHours, enabled: false } }
      : agent.guardrails,
    burstText,
    now: deps.now(),
    repliesSinceHuman,
    maxRepliesPerConversation: agent.maxRepliesPerConversation,
    unresolvedTurns,
  });

  if (block) {
    await run.step({ kind: "guardrail", name: block.kind, output: { accion: block.action, detalle: block.detail } });
    if (draftMode || rulesMode) {
      // En modo borrador el guardarrail no apaga el agente: deja una fila sin
      // texto en la cola, con el motivo, para que responda una persona.
      return leaveDraft(
        {
          body: null,
          bodyParts: null,
          noReplyReason: `guardrail:${block.kind}`,
          suggestedActions: [escalateSuggestion(`Guardarrail: ${block.detail}`)],
          appliedActions: [],
        },
        `guardrail:${block.kind}`,
      );
    }
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
    if (draftMode || rulesMode) {
      return leaveDraft(
        {
          body: null,
          bodyParts: null,
          noReplyReason: "guardrail:spend",
          suggestedActions: [escalateSuggestion("Se alcanzo el tope de gasto de IA")],
          appliedActions: [],
        },
        `spend:${spend.blocking.scope}`,
      );
    }
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

  // Contacto (etiquetas, temperatura): lo usan el prompt y las reglas.
  const contact = await loadContactContext(supabase, conversation.contact_id);

  // 6a. Reglas: evaluación previa (F9). Si una regla previa dice "No responder",
  // el turno termina sin llamar al modelo. Si decide send/draft, se recuerda y
  // se sigue generando; si devuelve "pending", se decide después de generar.
  let ruleDecision: RuleEvalResult | null = null;
  let ruleStage: "before" | "after" | null = null;
  let preRuleCtx: ReturnType<typeof buildPreRuleContext> | null = null;
  if (rulesMode) {
    const hasPriorMessages = messages.some((m) => ms(m.created_at) < ms(burst[0].created_at));
    const hasPriorOutbound = messages.some(
      (m) => m.direction === "outbound" && ms(m.created_at) < ms(burst[0].created_at),
    );
    preRuleCtx = buildPreRuleContext({
      burstText: burst.map((m) => m.text ?? "").join("\n"),
      burstCount: burst.length,
      lastInboundText: burst[burst.length - 1].text ?? null,
      temperature: contact.leadTemperature,
      tags: contact.tags,
      hasPriorOutbound,
      hasPriorMessages,
      assigned: conversation.assigned_to != null,
      channel: conversation.channel_id,
      inBusinessHours: isWithinBusinessHours(agent.guardrails, deps.now()),
    });
    const pre = evaluateRules(agent.responseRules, preRuleCtx, "before_generation", agent.responseRulesDefault);
    if (pre.action === "skip") {
      run.setRouting(routingFor("rules", pre, "before"));
      return close("skipped", pre.ruleId ? `rule:${pre.ruleId}` : "rule:default");
    }
    if (pre.action !== "pending") {
      // Una regla previa ya decidió enviar o dejar borrador: se genera igual y
      // se aplica al final. No hace falta la evaluación final.
      ruleDecision = pre;
      ruleStage = "before";
    }
  }

  // 5. El modelo.
  const nonce = newNonce();
  const [toolSet] = await Promise.all([
    buildToolSet({
      supabase,
      agent,
      workspaceId: conversation.workspace_id,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      channelId: conversation.channel_id,
      run,
      nonce,
      // En modo reglas las herramientas se difieren como en borrador: la
      // decisión de enviar o no se toma después de generar.
      mode: args.mode === "rules" ? "draft" : args.mode,
      readOnly: args.readOnlyTools,
    }),
  ]);
  const system = buildSystemPrompt(agent, nonce, Object.keys(toolSet.tools));
  const revision: DraftRevision | null = args.revision
    ? {
        previousBody: args.revision.previousBody,
        instruction: args.revision.instruction,
        alreadyApplied: args.revision.alreadyApplied,
        readOnly: args.readOnlyTools,
      }
    : null;
  const modelMessages = buildModelMessages({ history: toHistory(messages), contact, nonce, revision });

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

  const suggestions = toolSet.state.suggestions;
  const applied: AppliedAction[] = toolSet.state.applied;
  const withEscalate = (reason: string): SuggestedAction[] =>
    suggestions.some((s) => s.type === "escalate") ? suggestions : [...suggestions, escalateSuggestion(reason)];

  if (!generation.ok) {
    const kind: AgentErrorKind = generation.reason === "model_timeout" ? "model_timeout" : "provider_unavailable";
    if (draftMode || rulesMode) {
      // La fila en la cola es la unica senal: sin marca de error ni aviso de
      // "se derivo a una persona", que en modo borrador no seria cierto.
      return leaveDraft(
        {
          body: null,
          bodyParts: null,
          noReplyReason: `error:${kind}`,
          suggestedActions: withEscalate(kind === "model_timeout" ? "El modelo no respondio a tiempo" : "Fallaron el modelo principal y el de respaldo"),
          appliedActions: applied,
        },
        kind,
        generation.attempts.map((a) => `${a.role}: ${a.problem}`).join("; "),
      );
    }
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

  // F26: intención declarada por el agente. Se valida contra las categorías
  // inbound activas; un id inexistente guarda null.
  if (toolSet.state.intent) {
    const { data: cats } = await supabase
      .from("message_categories")
      .select("id")
      .eq("workspace_id", conversation.workspace_id)
      .eq("direction", "inbound")
      .is("archived_at", null);
    const validIds = new Set((cats ?? []).map((c) => (c as { id: string }).id));
    run.setIntent(validateIntent(toolSet.state.intent, validIds));
  }

  // 6. Formato, en codigo.
  const output = validateOutput(generation.output.text, agent.outputFormat);
  if (!output.ok && (draftMode || rulesMode)) {
    const suggestedEscalate = suggestions.some((s) => s.type === "escalate");
    // El agente decidio derivar y no hay nada que redactar: igual queda la
    // fila en la cola, con el motivo y sin texto, para responder a mano.
    if (output.reason === "empty" && suggestedEscalate) {
      return leaveDraft(
        { body: null, bodyParts: null, noReplyReason: "escalate", suggestedActions: suggestions, appliedActions: applied },
        joinDetails("suggested:derivar_a_humano", modelDetail),
      );
    }
    await run.step({ kind: "guardrail", name: "output_format", error: output.reason });
    return leaveDraft(
      {
        body: null,
        bodyParts: null,
        noReplyReason: `error:output_${output.reason}`,
        suggestedActions: withEscalate(output.reason === "empty" ? "El agente no genero una respuesta" : "La respuesta del agente no paso la validacion"),
        appliedActions: applied,
      },
      `output:${output.reason}`,
    );
  }
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

  // 6b. Reglas: evaluación final (F9). Si una regla previa ya decidió, se usa;
  // si no, se evalúa la lista completa con la respuesta ya generada.
  if (rulesMode) {
    if (!ruleDecision) {
      const finalCtx = fillResponseContext(preRuleCtx!, {
        responseText: output.parts.join("\n\n"),
        parts: output.parts.length,
        wantsEscalate: toolSet.state.escalated || suggestions.some((s) => s.type === "escalate"),
        kbMiss: false,
        usedTools: applied.map((a) => a.label),
        intent: null,
      });
      ruleDecision = evaluateRules(agent.responseRules, finalCtx, "after_generation", agent.responseRulesDefault);
      ruleStage = "after";
    }
    if (ruleDecision.action === "skip") {
      // No se envía ni se guarda. Las herramientas de clasificación que el
      // agente ejecutó ya quedaron aplicadas, y el run muestra los tokens.
      run.setRouting(routingFor("rules", ruleDecision, ruleStage ?? "after"));
      return close("skipped", ruleDecision.ruleId ? `rule:${ruleDecision.ruleId}` : "rule:default");
    }
    // La regla decide enviar directo o dejar borrador.
    draftMode = ruleDecision.action === "draft";
  }

  // 7. Espera hasta el objetivo. En modo borrador no hay demora deliberada: el
  // borrador se guarda apenas esta listo.
  const target = args.windowEnd + agent.responseDelaySeconds * 1000;
  const lastBurstId = burst[burst.length - 1].id;
  const interrupted = draftMode ? false : await waitUntilTarget(supabase, deps, conversation.id, target, lastBurstId);

  // 8. Nadie tomo la conversacion mientras se generaba. Un "forzado apagado"
  // (false) es lo que dejan Human Takeover y una respuesta manual; "heredar"
  // (null) sigue siendo del agente.
  const latest = await loadTurnConversation(supabase, conversation.id);
  const humanAfter = await lastHumanReplyAt(supabase, conversation.id);
  if (!latest || latest.agent_enabled === false || (humanAfter && isAfter(humanAfter, burst[0].created_at))) {
    return close("skipped", "human_took_over_during_generation");
  }
  const waiting = await findWaitingSession(supabase, {
    contactId: conversation.contact_id,
    channelId: conversation.channel_id,
  });
  if (waiting) return close("skipped_automation", "flow_session_during_generation");

  // 9. Momento 2 (F5): refrescar contra Zernio y verificar de nuevo, junto con
  // el envío/guardado. El chequeo va bajo advisory lock por conversación
  // (claim_agent_reply). Si ya hubo una respuesta después del inbound, no se
  // envía ni se guarda nada.
  const inboundAt = burst[burst.length - 1].created_at;
  const refresh2 = await deps.refresh(supabase, {
    conversationId: conversation.id,
    workspaceId: conversation.workspace_id,
    channelId: conversation.channel_id,
    lateConversationId: conversation.late_conversation_id,
    sinceIso: burst[0].created_at,
    runId,
  });
  if (await claimAgentReply(supabase, { conversationId: conversation.id, inboundAt, runId })) {
    run.setRouting({ check: "already_answered", moment: 2, refresh: refresh2.ok ? "ok" : "failed" });
    return close("already_answered", "after_generation");
  }

  // Si el refresco falló en modo directo, la verificación quedó ciega:
  // "Enviar directo" se degrada a borrador (routing.refresh = 'failed').
  const degradeToDraft = !draftMode && !refresh2.ok;
  const routingRefresh = refresh2.ok ? "ok" : "failed";
  // El routing en modo reglas lleva qué regla decidió; en directo/borrador, sólo el modo.
  const routingNow = (effectiveMode: string) =>
    rulesMode && ruleDecision
      ? routingFor("rules", ruleDecision, ruleStage ?? "after", routingRefresh)
      : { mode: effectiveMode, refresh: routingRefresh };

  if (draftMode || degradeToDraft) {
    run.setRouting(routingNow("draft"));
    return leaveDraft(
      {
        body: output.parts.join("\n\n"),
        bodyParts: output.parts,
        noReplyReason: null,
        suggestedActions: suggestions,
        appliedActions: applied,
      },
      joinDetails(modelDetail, output.truncated && "output_truncated", degradeToDraft && "refresh_failed"),
    );
  }

  run.setRouting(routingNow("send"));
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

/** Lo que la regeneracion le pasa al turno (Bloque 2c). */
interface TurnRevision {
  previousDraftId: string;
  previousBody: string | null;
  /** null si no hubo instruccion o si un mensaje nuevo del lead la dejo sin efecto. */
  instruction: string | null;
  alreadyApplied: string[];
}

interface PreviousDraft {
  id: string;
  body: string | null;
  burst_started_at: string | null;
  burst_last_inbound_at: string | null;
  applied_actions: unknown;
}

async function loadPreviousDraft(supabase: Db, draftId: string, conversationId: string): Promise<PreviousDraft | null> {
  const { data, error } = await supabase
    .from("agent_drafts")
    .select("id, body, burst_started_at, burst_last_inbound_at, applied_actions")
    .eq("id", draftId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) console.error("[agent-turn] no pude leer el borrador a regenerar:", error.message);
  return (data as PreviousDraft | null) ?? null;
}

/**
 * El borrador no se pudo guardar porque otro de la misma conversacion esta
 * saliendo en este instante (alguien lo aprobo). No es un error: se vuelve a
 * agendar el turno en un minuto. El envio termina en segundos, o el barrido de
 * 5 minutos lo pasa a failed, asi que el reintento siempre encuentra el camino
 * libre. Como el borrador no cierra la rafaga, el reintento responde todo.
 */
export const BLOCKED_RETRY_SECONDS = 60;

async function rescheduleBlockedTurn(
  supabase: Db,
  args: { deps: TurnDeps; conversation: TurnConversation; agent: AgentConfig; burst: StoredMessage[] },
): Promise<void> {
  const payload: AgentBurstPayload = {
    workspaceId: args.conversation.workspace_id,
    conversationId: args.conversation.id,
    channelId: args.conversation.channel_id,
    contactId: args.conversation.contact_id,
    agentId: args.agent.id,
    last_message_at: args.burst[args.burst.length - 1].created_at,
    blocked_retry: true,
  };
  try {
    await pushDebouncedJob(supabase, {
      type: AGENT_BURST_JOB,
      dedupeKey: agentBurstKey(args.conversation.id),
      payload: payload as unknown as Record<string, unknown>,
      runAt: new Date(args.deps.now().getTime() + BLOCKED_RETRY_SECONDS * 1000),
      deadline: null,
      volatileKeys: AGENT_BURST_VOLATILE_KEYS,
    });
  } catch (err) {
    console.error("[agent-turn] no pude reprogramar el turno bloqueado:", err instanceof Error ? err.message : "error desconocido");
    await markAgentError(supabase, {
      workspaceId: args.conversation.workspace_id,
      conversationId: args.conversation.id,
      runId: null,
      kind: "turn_error",
      assignedTo: args.conversation.assigned_to,
      now: args.deps.now(),
    });
  }
}
