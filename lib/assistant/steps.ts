/**
 * El asistente del equipo: los pasos de cada respuesta y el historial que ve el modelo.
 *
 * Cada respuesta del asistente guarda en `ai_messages.result` los pasos que dio: cada consulta (lectura) y cada
 * escritura propuesta. La pantalla los dibuja plegados y se pueden desplegar para ver qué devolvieron. Una escritura
 * nunca se hace sola: queda como propuesta (`ai_proposals`) y la persona la aprueba o la rechaza desde el panel.
 *
 * Módulo puro.
 */

import { z } from "zod";
import { REJECT_REASON_LABELS, isRejectReason } from "@/lib/ai-learning/reject-reasons";

export const ASSISTANT_MAX_INPUT = 4_000;
/** Cuántos mensajes anteriores ve el modelo (los más nuevos). */
export const ASSISTANT_HISTORY_LIMIT = 30;

export const assistantStepSchema = z
  .object({
    tool: z.string().max(80),
    label: z.string().max(200),
    access: z.enum(["read", "write"]),
    ok: z.boolean(),
    input: z.unknown().optional(),
    /** Lo que devolvió la consulta, ya recortado (`summarizeForStep`). */
    output: z.unknown().optional(),
    message: z.string().max(500),
    proposal_id: z.string().uuid().nullable().optional(),
  })
  .strict();
export type AssistantStep = z.infer<typeof assistantStepSchema>;

export const ASSISTANT_MAX_PLAN = 8;
/** Una respuesta «pensando» sin moverse en este tiempo se cortó (el servidor se reinició a mitad). */
export const ASSISTANT_STALL_MS = 3 * 60_000;

/**
 * Estado de una respuesta. La respuesta se guarda al empezar y se actualiza paso a paso: la pantalla se dibuja
 * desde lo guardado, que es también la auditoría. Sin `status` (respuestas de antes) vale como terminada.
 * - running: trabajando; `heartbeat_at` se mueve con cada paso.
 * - waiting: se pausó porque quiere escribir; espera que la persona apruebe o rechace la propuesta.
 * - done / failed: terminó (bien o con error).
 */
export const ASSISTANT_STATUSES = ["running", "waiting", "done", "failed"] as const;
export type AssistantStatus = (typeof ASSISTANT_STATUSES)[number];

export const assistantResultSchema = z
  .object({
    steps: z.array(assistantStepSchema).max(40),
    run_id: z.string().uuid().nullable().optional(),
    error: z.string().max(500).optional(),
    /** Lo que el asistente se propone hacer (no es una garantía: lo que pasó de verdad son los pasos). */
    plan: z.array(z.string().max(200)).max(ASSISTANT_MAX_PLAN).optional(),
    status: z.enum(ASSISTANT_STATUSES).optional(),
    heartbeat_at: z.string().max(40).optional(),
  })
  .strict();
export type AssistantResult = z.infer<typeof assistantResultSchema>;

/** El plan que manda el modelo, limpio: textos sin vacíos, recortados y como mucho 8. Puro. */
export function cleanPlan(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.replace(/\s+/g, " ").trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, ASSISTANT_MAX_PLAN);
}

export type TurnPhase = AssistantStatus | "stalled";

/** En qué está una respuesta, contando la que se cortó a mitad. Puro. */
export function turnPhase(result: Pick<AssistantResult, "status" | "heartbeat_at" | "error">, now: Date): TurnPhase {
  const status = result.status ?? (result.error ? "failed" : "done");
  if (status !== "running") return status;
  const beat = result.heartbeat_at ? Date.parse(result.heartbeat_at) : NaN;
  if (!Number.isFinite(beat) || now.getTime() - beat > ASSISTANT_STALL_MS) return "stalled";
  return "running";
}

/**
 * Si una respuesta se puede reanudar desde donde estaba: pausada con todas sus propuestas ya decididas (aunque sea
 * horas después), o cortada a mitad (se cerró la pestaña y el servidor no terminó). Puro.
 */
export function canResume(phase: TurnPhase, steps: readonly AssistantStep[], proposals: ReadonlyMap<string, ProposalState>): boolean {
  if (phase === "stalled") return true;
  if (phase !== "waiting") return false;
  const ids = steps.map((s) => s.proposal_id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return true;
  return ids.every((id) => {
    const p = proposals.get(id);
    return p ? proposalPhase(p.status) !== "pending" : false;
  });
}

/** Lo que se le dice al modelo para seguir: el estado de lo propuesto ya va en el historial. */
export const ASSISTANT_CONTINUE_PROMPT =
  "[Sigue desde el paso donde lo dejaste, con tu plan. Ten en cuenta lo que la persona decidió sobre lo propuesto; si lo rechazó, adáptate al motivo. No repitas los pasos que ya están hechos.]";

/** Lee el `result` de un mensaje del asistente; algo con otra forma vale como «sin pasos». */
export function parseAssistantResult(value: unknown): AssistantResult {
  const r = assistantResultSchema.safeParse(value);
  return r.success ? r.data : { steps: [] };
}

/** Lo que se sabe de una propuesta al volver a armar la conversación. */
export interface ProposalState {
  id: string;
  status: string;
  label: string;
  reject_reason: string | null;
  reject_note: string | null;
}

export type ProposalPhase = "pending" | "approved" | "rejected" | "failed" | "expired";

export function proposalPhase(status: string): ProposalPhase {
  if (status === "approved" || status === "approved_edited") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "failed") return "failed";
  if (status === "expired") return "expired";
  return "pending";
}

/** Una línea para el modelo con lo que pasó con una propuesta: así se adapta si la rechazaron. */
export function proposalNote(p: ProposalState): string {
  const phase = proposalPhase(p.status);
  if (phase === "approved") return `La persona aprobó «${p.label}» y ya está hecho.`;
  if (phase === "rejected") {
    const reason = isRejectReason(p.reject_reason) ? REJECT_REASON_LABELS[p.reject_reason] : "sin motivo";
    return `La persona rechazó «${p.label}» (motivo: ${reason}${p.reject_note ? `; nota: ${p.reject_note}` : ""}). No lo vuelvas a proponer igual.`;
  }
  if (phase === "failed") return `«${p.label}» se aprobó pero falló al hacerse.`;
  if (phase === "expired") return `«${p.label}» caducó sin decisión.`;
  return `«${p.label}» sigue esperando la aprobación de la persona.`;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  result: unknown;
}

export type ModelMessage = { role: "user" | "assistant"; content: string };

/**
 * El historial que ve el modelo: los últimos mensajes, en orden, con una nota por cada propuesta que dejó una
 * respuesta (aprobada, rechazada con su motivo o pendiente). Los datos que devolvió una consulta NO se reenvían: el
 * modelo vuelve a consultar si los necesita (así nunca ve datos viejos ni de más). Empieza siempre por la persona.
 */
export function historyForModel(messages: readonly StoredMessage[], proposals: ReadonlyMap<string, ProposalState>): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages.slice(-ASSISTANT_HISTORY_LIMIT)) {
    let content = m.content.trim();
    if (m.role === "assistant") {
      const notes = parseAssistantResult(m.result)
        .steps.map((s) => (s.proposal_id ? proposals.get(s.proposal_id) : undefined))
        .filter((p): p is ProposalState => Boolean(p))
        .map(proposalNote);
      if (notes.length > 0) content = `${content}\n\n[Estado de lo propuesto: ${notes.join(" ")}]`.trim();
    }
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  while (out[0]?.role === "assistant") out.shift();
  return out;
}

/** El texto de la persona, limpio. Vacío = no se manda nada. */
export function cleanAssistantInput(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\u0000/g, "").trim().slice(0, ASSISTANT_MAX_INPUT);
}

/** Los ids de propuesta que dejaron las respuestas de una conversación. */
export function proposalIdsOf(messages: readonly StoredMessage[]): string[] {
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const s of parseAssistantResult(m.result).steps) if (s.proposal_id) ids.add(s.proposal_id);
  }
  return [...ids];
}
