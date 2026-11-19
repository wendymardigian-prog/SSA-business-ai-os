/**
 * Motivos de rechazo de una propuesta de la IA. Lista CERRADA, gemela del CHECK de la 00441
 * (`ai_proposals_reject_reason_check` y `agent_drafts_reject_reason_check`); `reject-reasons.test.ts` las compara.
 * Sumar un motivo es sumarlo aquí Y en una migración nueva que amplíe los dos CHECK.
 *
 * Sin dependencias: lo importan la pantalla y el servidor.
 */

export const REJECT_REASONS = ["tone", "wrong_data", "not_this_client", "too_long", "missing_info", "other"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  tone: "Tono",
  wrong_data: "Dato incorrecto",
  not_this_client: "No corresponde a este cliente",
  too_long: "Demasiado largo",
  missing_info: "Falta información",
  other: "Otro (con nota)",
};

export const REJECT_NOTE_MAX = 500;

export function isRejectReason(value: unknown): value is RejectReason {
  return typeof value === "string" && (REJECT_REASONS as readonly string[]).includes(value);
}

export type RejectInput = { ok: true; reason: RejectReason; note: string | null } | { ok: false; error: string };

/** Valida el motivo y la nota como lo hará la base: «otro» exige nota; la nota tiene tope. */
export function parseRejectInput(reason: unknown, note: unknown): RejectInput {
  if (!isRejectReason(reason)) return { ok: false, error: "Elegí un motivo de la lista." };
  const clean = typeof note === "string" ? note.trim() : "";
  if (clean.length > REJECT_NOTE_MAX) return { ok: false, error: `La nota no puede pasar de ${REJECT_NOTE_MAX} caracteres.` };
  if (reason === "other" && !clean) return { ok: false, error: "Con «Otro», escribí una nota con el motivo." };
  return { ok: true, reason, note: clean || null };
}
