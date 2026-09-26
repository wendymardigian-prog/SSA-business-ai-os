/**
 * Revision y aprobacion de una pieza (F37).
 *
 * El circuito es: se manda a revision → alguien la aprueba, o la devuelve
 * con un comentario. Dos reglas lo definen:
 *
 * 1. **Devolver siempre lleva un comentario.** Una pieza que vuelve sin
 *    motivo obliga a preguntar por otro lado, y el trabajo se para hasta que
 *    alguien conteste. El comentario es obligatorio, no una cortesia.
 * 2. **Una pieza aprobada y programada no se edita sin desprogramar.** Si se
 *    pudiera, se editaria un caption que ya esta en la cola y saldria otra
 *    cosa de la que se aprobo.
 */

import type { ContentPostStatus } from "@/lib/types/database";
import type { ContentPermissions } from "./status";

export const MIN_COMMENT_LENGTH = 3;

export type ReviewDecision = { ok: true } | { ok: false; reason: string };

/** Mandar a revision. */
export function canRequestReview(
  perms: ContentPermissions,
  status: ContentPostStatus,
): ReviewDecision {
  if (status === "in_review") return { ok: false, reason: "Ya esta en revision." };
  if (status !== "draft" && status !== "in_production") {
    return { ok: false, reason: "Solo se manda a revision una pieza que se esta produciendo." };
  }
  if (!perms.create) return { ok: false, reason: "No tenes permiso para editar contenido." };
  if (!perms.isAuthor && !perms.approve) {
    return { ok: false, reason: "Solo el autor puede mandarla a revision." };
  }
  return { ok: true };
}

export function canApprove(perms: ContentPermissions, status: ContentPostStatus): ReviewDecision {
  if (!perms.approve) return { ok: false, reason: "Aprobar es de quien puede aprobar." };
  if (status !== "in_review") return { ok: false, reason: "Primero hay que enviarla a revision." };
  return { ok: true };
}

export function canReturn(
  perms: ContentPermissions,
  status: ContentPostStatus,
  comment: string,
): ReviewDecision {
  if (!perms.approve) return { ok: false, reason: "Devolver una pieza es de quien puede aprobar." };
  if (status !== "in_review" && status !== "approved") {
    return { ok: false, reason: "Solo se devuelve una pieza en revision o aprobada." };
  }
  if (comment.trim().length < MIN_COMMENT_LENGTH) {
    // Sin motivo, quien la escribio no sabe que cambiar.
    return { ok: false, reason: "Escribi que hay que cambiar antes de devolverla." };
  }
  return { ok: true };
}

/**
 * Si se puede editar el contenido de la pieza.
 *
 * Aprobada y sin programar todavia se edita: lo que congela es tener una
 * publicacion en la cola.
 */
export function canEditContent(params: {
  perms: ContentPermissions;
  status: ContentPostStatus;
  hasScheduledNetworks: boolean;
}): ReviewDecision {
  if (params.hasScheduledNetworks) {
    return {
      ok: false,
      reason: "Hay redes programadas. Desprogramalas para editar, si no sale algo distinto de lo aprobado.",
    };
  }
  if (params.status === "published" || params.status === "publishing") {
    return { ok: false, reason: "Una pieza que ya salio no se edita." };
  }
  if (params.perms.approve || params.perms.publish) return { ok: true };
  if (!params.perms.create) return { ok: false, reason: "No tenes permiso para editar contenido." };
  if (!params.perms.isAuthor) return { ok: false, reason: "Solo el autor puede editar su pieza." };
  return { ok: true };
}

/** El estado al que va la pieza en cada decision. */
export function statusAfterReview(decision: "request" | "approve" | "return"): ContentPostStatus {
  if (decision === "request") return "in_review";
  if (decision === "approve") return "approved";
  // Devolver la manda a produccion, no a borrador: el trabajo hecho sigue
  // estando, solo falta corregir.
  return "in_production";
}
