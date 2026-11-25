/**
 * «Volver a clasificar» a pedido de una persona (Grabaciones, selección múltiple). PURO.
 *
 * Decide qué hacer con cada grabación elegida:
 *  - lo que eligió una persona (`classification_source = 'human'`) no se toca;
 *  - lo analizado, o lo que se está clasificando o analizando, tampoco: conserva lo que tiene;
 *  - el resto (por revisar, pendiente, no aplica, con error) vuelve a la cola de clasificación, que aplica
 *    primero las reglas sin IA y pregunta a la IA solo si ninguna decide. A pedido de una persona sí usa
 *    la IA, también en lo importado del historial.
 */

/** Los estados que se pueden volver a clasificar: los mismos que mueve `reclassifyCall`. */
export const RECLASSIFIABLE_STATUSES = ["needs_review", "pending", "not_applicable", "error"] as const;

/** El tope por vez: una página de la lista de Grabaciones. */
export const RECLASSIFY_LIMIT = 30;

export type ReclassifySkip = "human" | "analyzed" | "busy";

export function reclassifyDecision(call: { classification_source: string | null; analysis_status: string }): { action: "requeue" } | { action: "skip"; why: ReclassifySkip } {
  if (call.classification_source === "human") return { action: "skip", why: "human" };
  if ((RECLASSIFIABLE_STATUSES as readonly string[]).includes(call.analysis_status)) return { action: "requeue" };
  if (call.analysis_status === "analyzed") return { action: "skip", why: "analyzed" };
  return { action: "skip", why: "busy" };
}

/** El aviso de la barra después de volver a clasificar. */
export function reclassifySummary(res: { queued: number; skipped: Partial<Record<ReclassifySkip | "not_found", number>> }): string {
  const parts: string[] = [];
  parts.push(res.queued === 1 ? "1 grabación vuelve a clasificarse" : `${res.queued} grabaciones vuelven a clasificarse`);
  const s = res.skipped;
  if (s.human) parts.push(s.human === 1 ? "1 tiene el tipo elegido a mano" : `${s.human} tienen el tipo elegido a mano`);
  if (s.analyzed) parts.push(s.analyzed === 1 ? "1 ya está analizada" : `${s.analyzed} ya están analizadas`);
  if (s.busy) parts.push(s.busy === 1 ? "1 se está procesando" : `${s.busy} se están procesando`);
  if (s.not_found) parts.push(s.not_found === 1 ? "1 no se encontró" : `${s.not_found} no se encontraron`);
  return `${parts.join("; ")}.`;
}
