import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { AGENT_BURST_JOB, agentBurstKey, scheduleJob, type AgentBurstPayload } from "@/lib/scheduler";
import { loadWorkspaceAgents, resolveAgentState } from "../config";
import type { DraftActionResult, DraftErrorCode } from "./actions";
import { LIVE_DRAFT_STATUSES } from "./types";

/**
 * "Sugerir respuesta" (A1): una persona pide a mano que el agente redacte una
 * respuesta para esta conversacion. Es la SEGUNDA puerta que agenda un turno
 * (la primera es `maybeScheduleAgentTurn`, por mensaje entrante); se separa a
 * proposito porque no es lo mismo: aca la pidio alguien ahora, el resultado es
 * siempre un BORRADOR (nunca se envia) y se salta lo que hace que el agente se
 * abstenga solo (alguien ya respondio, la conversacion tiene el agente apagado).
 *
 * Lo que SI exige: que haya un agente prendido para este canal y una IA
 * conectada. Sin eso no hay quien redacte, y se lo dice a la persona.
 */

type Db = SupabaseClient<Database>;

const fail = (code: DraftErrorCode, error: string): DraftActionResult => ({ ok: false, code, error });

export async function requestSuggestion(args: {
  /** Cliente de servicio: lee agentes e integraciones y agenda el turno. */
  service: Db;
  conversation: { id: string; workspace_id: string; channel_id: string; contact_id: string };
  now?: Date;
}): Promise<DraftActionResult> {
  const now = args.now ?? new Date();
  const { conversation, service } = args;

  const [agents, { data: levers, error: leversError }] = await Promise.all([
    loadWorkspaceAgents(service, conversation.workspace_id),
    service.from("conversations").select("agent_enabled, agent_paused_until").eq("id", conversation.id).maybeSingle(),
  ]);
  if (leversError || !levers) return fail("not_found", "No encontré esa conversación.");

  const state = resolveAgentState({ agents, channelId: conversation.channel_id, conversation: levers, now });
  if (state.state === "no_agent") return fail("agent_missing", "Todavía no hay un agente de IA. Se crea en Agentes IA.");
  if (state.state === "channel_off" || state.state === "agent_off") {
    return fail("agent_missing", "El agente está apagado para este canal. Prendelo en Agentes IA para pedirle sugerencias.");
  }

  // Sin una IA conectada no hay quien redacte.
  const providers = await listConnectedAiProviders(conversation.workspace_id, service);
  if (providers.length === 0) return fail("agent_missing", "No hay ninguna IA conectada. Conectala en Integraciones para pedir sugerencias.");

  const { data: open } = await service
    .from("agent_drafts")
    .select("id")
    .eq("conversation_id", conversation.id)
    .in("status", LIVE_DRAFT_STATUSES)
    .limit(1);
  if ((open ?? []).length > 0) return fail("turn_pending", "Ya hay un borrador esperando en esta conversación.");

  const { data: inbound } = await service
    .from("messages")
    .select("id")
    .eq("conversation_id", conversation.id)
    .eq("direction", "inbound")
    .limit(1);
  if ((inbound ?? []).length === 0) return fail("unknown", "El contacto todavía no escribió: no hay nada que responder.");

  const key = agentBurstKey(conversation.id);
  const { data: pendingJob } = await service.from("scheduled_jobs").select("id").eq("dedupe_key", key).eq("status", "pending").maybeSingle();
  if (pendingJob) return fail("turn_pending", "Ya se está preparando una respuesta para esta conversación.");

  const payload: AgentBurstPayload = {
    workspaceId: conversation.workspace_id,
    conversationId: conversation.id,
    channelId: conversation.channel_id,
    contactId: conversation.contact_id,
    agentId: state.agent.id,
    last_message_at: now.toISOString(),
    suggest: true,
  };
  try {
    await scheduleJob(service, AGENT_BURST_JOB, payload as unknown as Record<string, unknown>, now, key);
  } catch (err) {
    // Entre la consulta y el insert entro un mensaje y ya hay un turno agendado: ese turno responde todo.
    if ((err as { code?: string } | null)?.code === "23505") {
      return { ok: true, notice: "Justo entró un mensaje nuevo: la respuesta que se está preparando lo incluye." };
    }
    console.error("[suggest] no pude agendar la sugerencia:", err instanceof Error ? err.message : "error desconocido");
    return fail("unknown", "No pude pedir la sugerencia. Probá de nuevo.");
  }
  return { ok: true, notice: "Pedí una sugerencia: aparece acá en unos segundos." };
}
