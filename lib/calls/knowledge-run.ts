/**
 * Mandar UNA llamada a la base de conocimiento (F31). Es lo que corre el job
 * `call_index_knowledge`.
 *
 * Solo llamadas de venta (`cierre`, `seguimiento`, `triaje`) con transcripcion:
 * una reunion de equipo NUNCA entra (ni por boton ni en automatico). El documento
 * es siempre interno (`internal_only = true`) y lleva la etiqueta `llamadas`: lo
 * que se dijo en una llamada no llega al agente que habla con leads. Mandar dos
 * veces la misma llamada deja UN documento: el segundo reemplaza al primero.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { indexText } from "@/lib/knowledge/index-text";
import { segmentTranscript, transcriptToText, type Segment } from "./transcript-segments";
import { ideaDate } from "./summary";

type Db = SupabaseClient<Database>;

/** Los tipos de llamada que entran a Conocimiento. */
export const KNOWLEDGE_CALL_TYPES = ["cierre", "seguimiento", "triaje"] as const;
export const KNOWLEDGE_TAG = "llamadas";

export function knowledgeEligibility(call: { call_type: string | null; transcript: unknown }): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(call.transcript) || call.transcript.length === 0) return { ok: false, reason: "La llamada no tiene transcripción" };
  if (!call.call_type || !(KNOWLEDGE_CALL_TYPES as readonly string[]).includes(call.call_type)) return { ok: false, reason: "Este tipo de llamada no se manda a Conocimiento" };
  return { ok: true };
}

/** El pedazo como se indexa: con su minuto adelante, si lo tiene, para poder citar el momento. */
export function chunkText(segment: Segment): string {
  if (!segment.tsStart) return segment.content;
  const range = segment.tsEnd && segment.tsEnd !== segment.tsStart ? `${segment.tsStart} – ${segment.tsEnd}` : segment.tsStart;
  return `[${range}]\n${segment.content}`;
}

export type KnowledgeOutcome =
  | { outcome: "gone" }
  | { outcome: "not_eligible" }
  | { outcome: "ready"; documentId: string; chunks: number }
  /** El documento quedo en `error` con el motivo a la vista (sin Voyage, por ejemplo). */
  | { outcome: "error"; documentId: string | null; detail: string; retryable: boolean };

export async function runCallKnowledgeJob(deps: { db: Db; now?: Date }, payload: { callId: string; requestedBy?: string | null }): Promise<KnowledgeOutcome> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const { data: call } = await db
    .from("calls")
    .select("id, workspace_id, title, call_type, recorded_at, transcript, knowledge_document_id")
    .eq("id", payload.callId)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { outcome: "gone" };
  if (!knowledgeEligibility(call).ok) return { outcome: "not_eligible" };

  const { data: ws } = await db.from("workspaces").select("timezone").eq("id", call.workspace_id).maybeSingle();
  const date = ideaDate(call.recorded_at, ws?.timezone ?? "UTC");

  const result = await indexText(db, {
    workspaceId: call.workspace_id,
    title: `Llamada: ${call.title} (${date})`,
    tags: [KNOWLEDGE_TAG],
    internalOnly: true,
    sourceFilename: `llamada-${call.id}.md`,
    sourceMime: "text/markdown",
    contentMd: transcriptToText(call.transcript),
    chunks: segmentTranscript(call.transcript).map(chunkText),
    replaceDocumentId: call.knowledge_document_id,
    createdBy: payload.requestedBy ?? null,
    now,
  });

  if (result.documentId && result.documentId !== call.knowledge_document_id) {
    await db.from("calls").update({ knowledge_document_id: result.documentId }).eq("id", call.id);
  }
  if (result.status === "ready" && result.documentId) return { outcome: "ready", documentId: result.documentId, chunks: result.chunks };
  return { outcome: "error", documentId: result.documentId, detail: result.detail ?? "No se pudo indexar", retryable: result.retryable === true };
}
