import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { isSendable, messagingWindowHours, sendableUntil } from "@/lib/messaging-window";
import { AGENT_BURST_JOB, agentBurstKey, scheduleJob, type AgentBurstPayload } from "@/lib/scheduler";
import { loadAgentById } from "../config";
import { clearAgentError } from "../errors";
import { escalateToHuman } from "../escalate";
import { cutAtBoundary } from "../output";
import { defaultSend, sendAgentParts, type SendFn } from "../send";
import { pauseAgentInConversation } from "../tools/effects";
import { AUTO_DISCARD, DECIDABLE_DRAFT_STATUSES, parseSuggestedActions, type SuggestedAction } from "./types";

/**
 * Las decisiones sobre un borrador (Bloque 2c): enviar (tal cual o editado),
 * descartar y regenerar.
 *
 * Dos clientes, a proposito. El del USUARIO lee y toma el borrador: la RLS
 * aplica el scope de leads (un Member solo decide sobre los suyos) y el WITH
 * CHECK exige decided_by = auth.uid(). El SERVICE envia (claim_automated_send
 * es solo service role), escribe el mensaje, marca sent/failed y aplica las
 * sugerencias.
 *
 * Bloqueo optimista: tomar exige que el borrador siga en pending o failed. Si
 * otra persona ya decidio, el UPDATE no afecta filas y el mensaje es claro.
 *
 * LA TRAMPA: aprobar un borrador NO es una respuesta manual. El envio pasa por
 * sendAgentParts con las dos autorias (sent_by_agent_id + sent_by_user_id) y
 * nunca por applyManualReply. Si pasara por ahi, el agente quedaria forzado
 * apagado y el modo borrador funcionaria una sola vez por conversacion.
 */

type Db = SupabaseClient<Database>;

export type DraftErrorCode =
  | "not_found"
  | "already_decided"
  | "no_body"
  | "window_closed"
  | "superseded"
  | "answered_elsewhere"
  | "needs_confirmation"
  | "agent_missing"
  | "too_long"
  | "turn_pending"
  | "send_failed"
  | "unknown";

export type DraftActionResult =
  | { ok: true; notice?: string }
  | { ok: false; error: string; code: DraftErrorCode };

const fail = (code: DraftErrorCode, error: string): DraftActionResult => ({ ok: false, code, error });

const ALREADY_DECIDED = "Otra persona ya decidio sobre este borrador. La cola se actualiza sola.";
const MAX_EDITED_PARTS = 10;
const MAX_INSTRUCTION = 500;

interface DraftRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  conversation_id: string;
  contact_id: string;
  channel_id: string;
  run_id: string | null;
  status: string;
  body: string | null;
  body_parts: unknown;
  suggested_actions: unknown;
  burst_last_inbound_at: string | null;
}

const DRAFT_COLUMNS =
  "id, workspace_id, agent_id, conversation_id, contact_id, channel_id, run_id, status, body, body_parts, suggested_actions, burst_last_inbound_at";

async function loadDraft(user: Db, draftId: string): Promise<DraftRow | null> {
  if (typeof draftId !== "string" || !draftId) return null;
  const { data, error } = await user.from("agent_drafts").select(DRAFT_COLUMNS).eq("id", draftId).maybeSingle();
  if (error) console.error("[drafts] no pude leer el borrador:", error.message);
  return (data as DraftRow | null) ?? null;
}

const decidable = (status: string) => (DECIDABLE_DRAFT_STATUSES as string[]).includes(status);

/**
 * Parte un texto que escribio una persona en mensajes del largo del canal. A
 * diferencia de validateOutput, no toca el contenido (ni emojis ni recortes):
 * lo decidio una persona. Si no entra, se lo dice en vez de cortarlo.
 */
export function splitEdited(text: string, maxLength: number): string[] | null {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest) {
    if (parts.length >= MAX_EDITED_PARTS) return null;
    const { head, rest: remaining } = cutAtBoundary(rest, maxLength);
    if (head) parts.push(head);
    rest = remaining;
  }
  return parts;
}

function storedParts(draft: DraftRow): string[] {
  const parts = Array.isArray(draft.body_parts) ? draft.body_parts.filter((p): p is string => typeof p === "string" && p.trim() !== "") : [];
  return parts.length ? parts : draft.body ? [draft.body] : [];
}

// ---------------------------------------------------------------------------
// Enviar
// ---------------------------------------------------------------------------

export async function approveDraft(args: {
  user: Db;
  service: Db;
  userId: string;
  draftId: string;
  /** Texto editado. Vacio o igual al propuesto = enviar tal cual. */
  body?: string | null;
  confirmedDoNotContact?: boolean;
  send?: SendFn;
  now?: Date;
}): Promise<DraftActionResult> {
  const now = args.now ?? new Date();
  const draft = await loadDraft(args.user, args.draftId);
  if (!draft) return fail("not_found", "No encontre ese borrador, o no es de tus leads.");
  if (!decidable(draft.status)) return fail("already_decided", ALREADY_DECIDED);

  const edited = typeof args.body === "string" && args.body.trim() !== "" && args.body.trim() !== (draft.body ?? "").trim();
  const text = edited ? (args.body as string).trim() : draft.body;
  if (!text) return fail("no_body", "Este borrador no tiene texto propuesto: respondé a mano desde la conversación.");
  if (!draft.agent_id) return fail("agent_missing", "El agente que lo redacto ya no existe. Respondé a mano desde la conversación.");

  const [{ data: channel }, { data: conversation }, { data: contact }, { data: later }] = await Promise.all([
    args.service.from("channels").select("platform, messaging_window_hours").eq("id", draft.channel_id).maybeSingle(),
    args.service.from("conversations").select("late_conversation_id").eq("id", draft.conversation_id).maybeSingle(),
    args.service.from("contacts").select("do_not_contact").eq("id", draft.contact_id).maybeSingle(),
    draft.burst_last_inbound_at
      ? args.service
          .from("messages")
          .select("id, direction, status, created_at")
          .eq("conversation_id", draft.conversation_id)
          .gt("created_at", draft.burst_last_inbound_at)
          // Un envio que fallo (por ejemplo, el primer intento de este mismo
          // borrador) no es una respuesta: el lead nunca lo recibio.
          .neq("status", "failed")
          .order("created_at", { ascending: true })
          .limit(20)
      : Promise.resolve({ data: [] as Array<{ direction: string; status: string }> }),
  ]);

  // Lo que paso en la conversacion despues de la rafaga que responde.
  const after = (later ?? []) as Array<{ direction: string }>;
  if (after.some((m) => m.direction === "inbound")) {
    await args.service
      .from("agent_drafts")
      .update({ status: "superseded" })
      .eq("id", draft.id)
      .in("status", DECIDABLE_DRAFT_STATUSES);
    return fail("superseded", "El lead volvió a escribir: este borrador ya no responde lo último que dijo. El agente va a preparar otro.");
  }
  if (after.some((m) => m.direction === "outbound")) {
    await args.service
      .from("agent_drafts")
      .update({ status: "discarded", discard_reason: AUTO_DISCARD.answeredElsewhere, decided_by: args.userId, decided_at: now.toISOString() })
      .eq("id", draft.id)
      .in("status", DECIDABLE_DRAFT_STATUSES);
    return fail("answered_elsewhere", "Ya hubo una respuesta en esta conversación después de este borrador. Lo saqué de la cola para no mandar dos.");
  }

  // La ventana se recalcula contra el ultimo mensaje real del lead, no contra
  // el valor guardado: el canal pudo cambiar de configuracion en el medio.
  const windowHours = channel ? messagingWindowHours(channel) : 0;
  if (!isSendable(sendableUntil(draft.burst_last_inbound_at, windowHours), now)) {
    return fail(
      "window_closed",
      `Pasaron más de ${windowHours} horas desde el último mensaje del lead: la plataforma ya no deja responderle. Respondé a mano si hace falta.`,
    );
  }

  if (contact?.do_not_contact && args.confirmedDoNotContact !== true) {
    return fail("needs_confirmation", "Este contacto está marcado como \"no contactar\". Confirmá si querés enviar igual.");
  }

  const agent = await loadAgentById(args.service, draft.agent_id);
  if (!agent) return fail("agent_missing", "El agente que lo redacto ya no existe. Respondé a mano desde la conversación.");
  const format = agent.outputFormat;

  const parts = edited ? splitEdited(text, format.maxLength) : storedParts(draft);
  if (!parts || parts.length === 0) {
    return fail("too_long", `El texto es demasiado largo: entra en hasta ${MAX_EDITED_PARTS} mensajes de ${format.maxLength} caracteres.`);
  }

  // Tomarlo. Bloqueo optimista: solo si sigue decidible.
  const { data: taken, error: takeError } = await args.user
    .from("agent_drafts")
    .update({ status: "sending", decided_by: args.userId, decided_at: now.toISOString(), sent_body: text })
    .eq("id", draft.id)
    .in("status", DECIDABLE_DRAFT_STATUSES)
    .select("id");
  if (takeError) {
    console.error("[drafts] no pude tomar el borrador:", takeError.message);
    return fail("unknown", "No pude tomar el borrador. Probá de nuevo.");
  }
  if (!taken || taken.length === 0) return fail("already_decided", ALREADY_DECIDED);

  const result = await sendAgentParts(
    args.service,
    {
      workspaceId: draft.workspace_id,
      channelId: draft.channel_id,
      contactId: draft.contact_id,
      conversationId: draft.conversation_id,
      lateConversationId: conversation?.late_conversation_id ?? null,
      agentId: draft.agent_id,
      runId: draft.run_id,
      sentByUserId: args.userId,
    },
    parts,
    args.send ?? defaultSend,
  );

  if (result.sent === 0) {
    const failure = result.failure;
    await args.service
      .from("agent_drafts")
      .update({
        status: "failed",
        send_error: failure?.message ?? "No se pudo enviar.",
        // Instagram dijo que la ventana cerro: la fila pasa a "responder a mano".
        ...(failure?.kind === "outside_window" ? { sendable_until: now.toISOString() } : {}),
      })
      .eq("id", draft.id)
      .eq("status", "sending");
    return fail("send_failed", failure?.hint ? `${failure.message} ${failure.hint}` : (failure?.message ?? "No se pudo enviar. Probá de nuevo."));
  }

  // Salio al menos una parte: queda enviado. Las que ya salieron no se reenvian nunca.
  const partial = result.failure ? `partial_send:${result.sent}/${parts.length}` : null;
  await args.service
    .from("agent_drafts")
    .update({ status: "sent", sent_message_id: result.firstMessageId, send_error: partial })
    .eq("id", draft.id)
    .eq("status", "sending");

  await applySuggestions(args.service, draft, args.userId, now);
  await clearAgentError(args.service, draft.conversation_id);

  return partial
    ? { ok: true, notice: `Salieron ${result.sent} de ${parts.length} mensajes. El resto falló: ${result.failure?.message ?? "error del canal"}.` }
    : { ok: true };
}

/**
 * Las sugerencias del agente (derivar, pausarse) se aplican al aprobar, con el
 * agente como actor y la persona en metadata.approved_by: aparecen en la
 * pestana Acciones y se pueden revertir.
 */
async function applySuggestions(service: Db, draft: DraftRow, userId: string, now: Date): Promise<void> {
  const suggestions: SuggestedAction[] = parseSuggestedActions(draft.suggested_actions);
  if (!draft.agent_id) return;
  const meta = { approved_by: userId, draft_id: draft.id };
  for (const s of suggestions) {
    try {
      if (s.type === "escalate") {
        await escalateToHuman(service, {
          workspaceId: draft.workspace_id,
          conversationId: draft.conversation_id,
          contactId: draft.contact_id,
          channelId: draft.channel_id,
          agentId: draft.agent_id,
          runId: draft.run_id,
          reason: s.reason,
          summary: s.summary,
          origin: "draft_approval",
          reopen: s.reopen,
          extraMeta: meta,
        });
      } else if (s.type === "pause") {
        await pauseAgentInConversation(
          {
            supabase: service,
            workspaceId: draft.workspace_id,
            agentId: draft.agent_id,
            runId: draft.run_id,
            conversationId: draft.conversation_id,
            contactId: draft.contact_id,
            channelId: draft.channel_id,
            origin: "draft_approval",
            extraMeta: meta,
          },
          { maxMinutes: s.maxMinutes, autoResume: s.autoResume },
          { minutes: s.minutes, reason: s.reason, now },
        );
      }
    } catch (err) {
      console.error("[drafts] no pude aplicar una sugerencia:", err instanceof Error ? err.message : "error desconocido");
    }
  }
}

// ---------------------------------------------------------------------------
// Descartar
// ---------------------------------------------------------------------------

export async function discardDraft(args: {
  user: Db;
  userId: string;
  draftId: string;
  reason?: string | null;
  now?: Date;
}): Promise<DraftActionResult> {
  const reason = typeof args.reason === "string" ? args.reason.trim().slice(0, 300) : "";
  if (reason.startsWith("auto:")) return fail("unknown", "Motivo invalido.");
  const { data, error } = await args.user
    .from("agent_drafts")
    .update({
      status: "discarded",
      discard_reason: reason || null,
      decided_by: args.userId,
      decided_at: (args.now ?? new Date()).toISOString(),
    })
    .eq("id", args.draftId)
    .in("status", DECIDABLE_DRAFT_STATUSES)
    .select("id");
  if (error) {
    console.error("[drafts] no pude descartar:", error.message);
    return fail("unknown", "No pude descartar el borrador. Probá de nuevo.");
  }
  if (!data || data.length === 0) return fail("already_decided", ALREADY_DECIDED);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Regenerar
// ---------------------------------------------------------------------------

/**
 * Pide otra version. El orden importa:
 *
 *   1. Si ya hay un turno agendado para la conversacion (el lead volvio a
 *      escribir), no se encola otro: ese turno va a responder todo.
 *   2. Se toma el borrador (CAS a regenerated): si otra persona ya decidio,
 *      no se encola nada.
 *   3. Se encola el turno con la MISMA clave del burst (agent_burst:<conv>):
 *      nunca corren dos turnos a la vez sobre la misma conversacion, y un
 *      mensaje que llegue despues reprograma este mismo job (y descarta la
 *      instruccion, que es volatil) en vez de duplicarlo.
 *
 * Si el insert choca con la clave (entre 1 y 3 entro un mensaje y ya hay un
 * turno agendado), no se revierte nada: la decision de regenerar ya estaba
 * tomada, y el turno del mensaje nuevo responde toda la rafaga. Solo se avisa.
 */
export async function regenerateDraft(args: {
  user: Db;
  service: Db;
  userId: string;
  draftId: string;
  instruction?: string | null;
  now?: Date;
}): Promise<DraftActionResult> {
  const now = args.now ?? new Date();
  const draft = await loadDraft(args.user, args.draftId);
  if (!draft) return fail("not_found", "No encontre ese borrador, o no es de tus leads.");
  if (!decidable(draft.status)) return fail("already_decided", ALREADY_DECIDED);
  if (!draft.agent_id) return fail("agent_missing", "El agente que lo redacto ya no existe.");

  const key = agentBurstKey(draft.conversation_id);
  const { data: pendingJob } = await args.service
    .from("scheduled_jobs")
    .select("id")
    .eq("dedupe_key", key)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingJob) {
    return fail("turn_pending", "El lead volvió a escribir: ya se está preparando una respuesta nueva que incluye su mensaje.");
  }

  const instruction = typeof args.instruction === "string" ? args.instruction.trim().slice(0, MAX_INSTRUCTION) : "";
  const { data: taken, error } = await args.user
    .from("agent_drafts")
    .update({ status: "regenerated", regenerate_instruction: instruction || null, decided_by: args.userId, decided_at: now.toISOString() })
    .eq("id", draft.id)
    .in("status", DECIDABLE_DRAFT_STATUSES)
    .select("id");
  if (error) {
    console.error("[drafts] no pude tomar el borrador para regenerar:", error.message);
    return fail("unknown", "No pude pedir otra versión. Probá de nuevo.");
  }
  if (!taken || taken.length === 0) return fail("already_decided", ALREADY_DECIDED);

  const payload: AgentBurstPayload = {
    workspaceId: draft.workspace_id,
    conversationId: draft.conversation_id,
    channelId: draft.channel_id,
    contactId: draft.contact_id,
    agentId: draft.agent_id,
    last_message_at: draft.burst_last_inbound_at ?? now.toISOString(),
    regenerate_of: draft.id,
    regenerate_instruction: instruction || null,
  };
  try {
    await scheduleJob(args.service, AGENT_BURST_JOB, payload as unknown as Record<string, unknown>, now, key);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      return { ok: true, notice: "El lead volvió a escribir justo ahora: la respuesta nueva va a incluir su mensaje." };
    }
    console.error("[drafts] no pude encolar la regeneracion:", err instanceof Error ? err.message : "error desconocido");
    // Sin turno encolado el borrador desapareceria sin reemplazo: vuelve a la cola.
    await args.service
      .from("agent_drafts")
      .update({ status: "pending", regenerate_instruction: null, decided_by: null, decided_at: null })
      .eq("id", draft.id)
      .eq("status", "regenerated");
    return fail("unknown", "No pude pedir otra versión. Probá de nuevo.");
  }
  return { ok: true, notice: "Pedí otra versión: aparece en la cola en unos segundos." };
}
