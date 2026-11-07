/**
 * La conversación con la IA, como la ve el panel (F31).
 *
 * Convierte las filas de `ai_messages` (canal `designer`) en `AiMessageView`
 * leyendo `context` y `result` sin lanzar nunca: una fila vieja o rara se ve
 * igual, con lo que tenga. «Pendiente» = el último mensaje es de la persona y
 * todavía no tiene respuesta (el job la agrega al terminar, bien o mal); si pasa
 * media hora sin respuesta se da por abandonado y no bloquea pedidos nuevos.
 *
 * Módulo puro.
 */

import type { AiMessageView } from "../contracts";
import { parseAttachments } from "@/lib/ai-threads/schema";

/** Una fila de `ai_messages` con lo que necesita el panel. */
export interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments: unknown;
  context: unknown;
  result: unknown;
  created_at: string;
}

/** Cuánto espera un pedido sin respuesta antes de darse por abandonado. */
export const PENDING_STALE_MS = 30 * 60_000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
}

/** ¿Hay un pedido de la persona esperando respuesta? */
export function isPending(rows: readonly Pick<MessageRow, "role" | "created_at">[], now: Date): boolean {
  const last = rows[rows.length - 1];
  if (!last || last.role !== "user") return false;
  return now.getTime() - new Date(last.created_at).getTime() < PENDING_STALE_MS;
}

export function toMessageView(row: MessageRow, pending = false): AiMessageView {
  const context = isObj(row.context) ? row.context : {};
  const scope = isObj(context.scope) ? context.scope : {};
  const result = isObj(row.result) ? row.result : {};
  const proposal = isObj(result.proposal) ? result.proposal : null;
  const attachments = parseAttachments(row.attachments);
  const kind = proposal?.kind;
  const status = proposal?.status;
  const summary = typeof result.summary === "string" && result.summary.trim() ? result.summary : null;
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    attachments: attachments.ok ? attachments.value : [],
    scopePage: typeof scope.page === "number" ? scope.page : null,
    changedPages: numbers(result.changed_pages),
    summary,
    warnings: strings(result.warnings),
    proposal:
      (kind === "template_texts" || kind === "enable_verification") && (status === "pending" || status === "accepted" || status === "declined")
        ? { kind, status }
        : null,
    pending,
  };
}

/** Todos los mensajes de un hilo para el panel; el último de la persona queda `pending` si todavía no tiene respuesta. */
export function toMessageViews(rows: readonly MessageRow[], now: Date): AiMessageView[] {
  const pending = isPending(rows, now);
  return rows.map((row, i) => toMessageView(row, pending && i === rows.length - 1));
}

/** El texto de un error de la respuesta, si la respuesta fue un error. */
export function errorOf(result: unknown): string | null {
  if (!isObj(result)) return null;
  return typeof result.error === "string" && result.error ? result.error : null;
}

/** Los últimos mensajes (sin el pedido que se está contestando) para darle contexto a la IA. */
export function recentHistory(rows: readonly MessageRow[], untilMessageId: string, limit = 6): { role: "user" | "assistant"; content: string }[] {
  const index = rows.findIndex((r) => r.id === untilMessageId);
  const before = index < 0 ? rows : rows.slice(0, index);
  return before
    .filter((r) => r.content.trim().length > 0 && errorOf(r.result) === null)
    .slice(-limit)
    .map((r) => ({ role: r.role, content: r.content }));
}

/** ¿El pedido ya tiene una respuesta (un mensaje de la IA después de él)? */
export function hasAnswer(rows: readonly Pick<MessageRow, "id" | "role">[], userMessageId: string): boolean {
  const index = rows.findIndex((r) => r.id === userMessageId);
  if (index < 0) return false;
  return rows.slice(index + 1).some((r) => r.role === "assistant");
}
