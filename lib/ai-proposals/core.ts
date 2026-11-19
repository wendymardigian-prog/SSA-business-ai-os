import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";
import type { AiRunHandle } from "@/lib/ai/run";
import { loadAgentById } from "@/lib/agent/config";
import { getAgentTool } from "@/lib/agent/tools";
import { parseRejectInput } from "@/lib/ai-learning/reject-reasons";
import { runPersonTool } from "@/lib/ai-tools/run";
import type { PersonToolContext } from "@/lib/ai-tools/types";
import { agentToolPermission } from "./agent-tools";
import { paramsWereEdited, type ProposalExecutor } from "./types";

/**
 * Aprobar o rechazar una propuesta.
 *
 *  - La persona tiene que VER la propuesta (la RLS de `ai_proposals` con su sesión) y tener el permiso de la acción.
 *    Una propuesta del asistente (`person_tool`) solo la aprueba quien la pidió: se ejecuta con su identidad.
 *  - Aprobar reclama la fila (`pending → approving`) antes de ejecutar: dos clics o dos personas = una ejecución.
 *  - Se guardan los parámetros propuestos y los finales; si cambiaron, queda «aprobada con edición».
 *  - Lo que ejecuta queda en el historial con el agente como autor y quién aprobó (`metadata.approved_by`).
 *  - Rechazar exige un motivo de la lista cerrada («otro» con nota).
 */

type Db = SupabaseClient<Database>;

export interface DecideActor {
  /** El cliente de la persona (la RLS decide qué ve). */
  session: Db;
  service: Db;
  userId: string;
  userName?: string;
  timeZone: string;
  can: (key: string) => boolean;
}

export type DecideResult =
  | { ok: true; status: "approved" | "approved_edited" | "rejected"; message: string }
  | { ok: false; code: "not_found" | "forbidden" | "already_decided" | "invalid" | "failed"; error: string };

interface ProposalRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  run_id: string | null;
  requested_by: string | null;
  channel_id: string | null;
  conversation_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  tool_key: string;
  label: string;
  params_proposed: Json;
  tool_config: Json;
  status: string;
}

const NOT_FOUND = "No encontramos esa propuesta (o no tenés acceso).";
async function loadVisible(actor: DecideActor, workspaceId: string, proposalId: string): Promise<ProposalRow | null> {
  if (typeof proposalId !== "string" || !/^[0-9a-f-]{36}$/i.test(proposalId)) return null;
  // Primero con la SESIÓN: si la persona no la ve, no existe para ella.
  const { data: visible } = await actor.session.from("ai_proposals").select("id").eq("id", proposalId).eq("workspace_id", workspaceId).maybeSingle();
  if (!visible) return null;
  const { data } = await actor.service
    .from("ai_proposals")
    .select("id, workspace_id, agent_id, run_id, requested_by, channel_id, conversation_id, subject_type, subject_id, tool_key, label, params_proposed, tool_config, status")
    .eq("id", proposalId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return (data as ProposalRow | null) ?? null;
}

export function executorOf(row: Pick<ProposalRow, "tool_config">): ProposalExecutor {
  const cfg = row.tool_config as { executor?: unknown } | null;
  return cfg?.executor === "person_tool" ? "person_tool" : "agent_tool";
}

/** El permiso que pide decidir esta propuesta. */
export function permissionFor(row: Pick<ProposalRow, "tool_key" | "tool_config">, personToolPermission?: (key: string) => string | null): string {
  if (executorOf(row) === "person_tool") return personToolPermission?.(row.tool_key) ?? "assistant.use";
  return agentToolPermission(row.tool_key);
}

/** Una ejecución de mentira para reusar las herramientas del agente fuera de un turno. */
function proposalRunHandle(runId: string | null): AiRunHandle {
  return {
    runId,
    setModel() {},
    addStepUsage() {},
    setFinalUsage() {},
    addEmbeddingUsage() {},
    addAudioUsage() {},
    async step() {
      return null;
    },
    setRouting() {},
    setIntent() {},
    async close() {
      return { costUsd: null, pricingMissing: [] };
    },
  };
}

interface ExecOutcome {
  ok: boolean;
  message: string;
  auditLogId: string | null;
  result: Json | null;
}

async function executeAgentTool(actor: DecideActor, row: ProposalRow, params: Record<string, unknown>): Promise<ExecOutcome> {
  const definition = getAgentTool(row.tool_key);
  if (!definition) return { ok: false, message: "Esa acción ya no existe.", auditLogId: null, result: null };
  const agent = row.agent_id ? await loadAgentById(actor.service, row.agent_id) : null;
  if (!agent || agent.workspaceId !== row.workspace_id) return { ok: false, message: "El agente ya no existe.", auditLogId: null, result: null };
  const input = definition.inputSchema.safeParse(params);
  if (!input.success) return { ok: false, message: input.error.issues[0]?.message ?? "Parámetros inválidos.", auditLogId: null, result: null };
  const rawConfig = (row.tool_config as { config?: unknown } | null)?.config ?? {};
  const config = definition.configSchema.safeParse(rawConfig);
  const result = await definition.execute({
    input: input.data,
    config: config.success ? config.data : definition.configSchema.parse({}),
    ctx: {
      supabase: actor.service,
      agent,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      contactId: row.subject_type === "contact" ? row.subject_id : null,
      channelId: row.channel_id,
      run: proposalRunHandle(row.run_id),
      nonce: randomUUID(),
      mode: "send",
    },
  });
  return { ok: result.ok, message: result.forModel, auditLogId: result.auditLogId ?? null, result: (result.detail ?? null) as Json };
}

async function executePersonTool(actor: DecideActor, row: ProposalRow, params: Record<string, unknown>): Promise<ExecOutcome> {
  const ctx: PersonToolContext = {
    supabase: actor.session as never,
    service: actor.service as never,
    workspaceId: row.workspace_id,
    userId: actor.userId,
    actorName: actor.userName,
    timeZone: actor.timeZone,
    can: actor.can,
  };
  const out = await runPersonTool(ctx, row.tool_key, params, { byAi: false, approved: true });
  return {
    ok: out.ok,
    message: out.message,
    auditLogId: out.ok && "auditLogId" in out ? out.auditLogId ?? null : null,
    result: (out.ok && "entityId" in out ? { entity_id: out.entityId ?? null } : null) as Json,
  };
}

/** Deja en el historial quién aprobó lo que hizo el agente. Nunca lanza. */
async function stampApproval(actor: DecideActor, auditLogId: string, proposalId: string): Promise<void> {
  try {
    const { data } = await actor.service.from("audit_log").select("metadata").eq("id", auditLogId).maybeSingle();
    const metadata = { ...(((data?.metadata as Record<string, Json> | null) ?? {}) as Record<string, Json>), approved_by: actor.userId, proposal_id: proposalId };
    await actor.service.from("audit_log").update({ metadata } as never).eq("id", auditLogId);
  } catch (err) {
    console.error("[ai-proposals] no pude anotar quién aprobó:", err instanceof Error ? err.message : String(err));
  }
}

export async function approveProposalCore(
  actor: DecideActor,
  input: { workspaceId: string; proposalId: string; editedParams?: unknown; personToolPermission?: (key: string) => string | null },
): Promise<DecideResult> {
  const row = await loadVisible(actor, input.workspaceId, input.proposalId);
  if (!row) return { ok: false, code: "not_found", error: NOT_FOUND };
  if (row.status !== "pending") return { ok: false, code: "already_decided", error: "Esta propuesta ya la decidió otra persona." };

  const executor = executorOf(row);
  if (executor === "person_tool" && row.requested_by !== actor.userId) {
    return { ok: false, code: "forbidden", error: "Esta propuesta la aprueba la persona que se la pidió al asistente." };
  }
  const permission = permissionFor(row, input.personToolPermission);
  if (!actor.can(permission)) return { ok: false, code: "forbidden", error: "Tu rol no puede hacer esta acción, así que tampoco aprobarla." };

  const proposed = (row.params_proposed ?? {}) as Record<string, unknown>;
  const finalParams =
    input.editedParams && typeof input.editedParams === "object" && !Array.isArray(input.editedParams)
      ? { ...proposed, ...(input.editedParams as Record<string, unknown>) }
      : proposed;
  const edited = paramsWereEdited(proposed, finalParams);

  // El reclamo: solo una persona (y un solo clic) se queda con la propuesta.
  const { data: claimed } = await actor.service
    .from("ai_proposals")
    .update({ status: "approving", decided_by: actor.userId, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, code: "already_decided", error: "Esta propuesta ya la decidió otra persona." };

  let outcome: ExecOutcome;
  try {
    outcome = executor === "person_tool" ? await executePersonTool(actor, row, finalParams) : await executeAgentTool(actor, row, finalParams);
  } catch (err) {
    console.error("[ai-proposals] la acción falló:", err instanceof Error ? err.message : String(err));
    outcome = { ok: false, message: "La acción falló.", auditLogId: null, result: null };
  }

  const now = new Date().toISOString();
  if (!outcome.ok) {
    await actor.service
      .from("ai_proposals")
      .update({ status: "failed", error: outcome.message.slice(0, 300), params_final: finalParams as Json, decided_at: now, updated_at: now })
      .eq("id", row.id);
    return { ok: false, code: "failed", error: outcome.message || "No se pudo aplicar." };
  }

  const status = edited ? "approved_edited" : "approved";
  await actor.service
    .from("ai_proposals")
    .update({ status, params_final: finalParams as Json, result: outcome.result, audit_log_id: outcome.auditLogId, decided_at: now, updated_at: now })
    .eq("id", row.id);
  if (outcome.auditLogId) await stampApproval(actor, outcome.auditLogId, row.id);

  // La decisión misma también queda, con el agente y la persona.
  await logAudit({
    supabase: actor.service,
    workspaceId: row.workspace_id,
    entityType: "ai_proposal",
    entityId: row.id,
    action: "ai_proposal.approved",
    changes: edited ? { params: { old: JSON.stringify(proposed).slice(0, 500), new: JSON.stringify(finalParams).slice(0, 500) } } : null,
    metadata: { tool: row.tool_key, approved_by: actor.userId, agent_id: row.agent_id, edited, conversation_id: row.conversation_id },
    performedBy: actor.userId,
  });
  return { ok: true, status, message: edited ? "Aprobada con tu edición." : "Aprobada." };
}

export async function rejectProposalCore(
  actor: DecideActor,
  input: { workspaceId: string; proposalId: string; reason: unknown; note?: unknown },
): Promise<DecideResult & { agentId?: string | null; reason?: string }> {
  const parsed = parseRejectInput(input.reason, input.note);
  if (!parsed.ok) return { ok: false, code: "invalid", error: parsed.error };
  const row = await loadVisible(actor, input.workspaceId, input.proposalId);
  if (!row) return { ok: false, code: "not_found", error: NOT_FOUND };
  if (executorOf(row) === "person_tool" && row.requested_by !== actor.userId) {
    return { ok: false, code: "forbidden", error: "Esta propuesta la decide la persona que se la pidió al asistente." };
  }
  const now = new Date().toISOString();
  const { data: updated } = await actor.service
    .from("ai_proposals")
    .update({ status: "rejected", reject_reason: parsed.reason, reject_note: parsed.note, decided_by: actor.userId, decided_at: now, updated_at: now })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");
  if (!updated || updated.length === 0) return { ok: false, code: "already_decided", error: "Esta propuesta ya la decidió otra persona." };
  await logAudit({
    supabase: actor.service,
    workspaceId: row.workspace_id,
    entityType: "ai_proposal",
    entityId: row.id,
    action: "ai_proposal.rejected",
    metadata: { tool: row.tool_key, reason: parsed.reason, agent_id: row.agent_id, conversation_id: row.conversation_id },
    performedBy: actor.userId,
  });
  return { ok: true, status: "rejected", message: "Rechazada.", agentId: row.agent_id, reason: parsed.reason };
}
