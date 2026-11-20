// @plantilla-quitar(servicios)
/**
 * El tilde de cada paso en la ficha del servicio (00503). PURO: lo que se muestra; quien decide es la base
 * (`svc_complete_item` no mira la fase; `svc_uncomplete_item` rechaza destildar en una fase cerrada, SV020).
 *
 * - Sin `services.items`, ni tildar ni destildar.
 * - Un paso pendiente se tilda aunque su fase esté cerrada (por ejemplo, el Onboarding que se cerró a mano con el
 *   contrato sin firmar en el sistema), salvo que tenga candado.
 * - Un paso completo de una fase cerrada NO se destilda.
 */
export interface ItemToggleInput {
  canItems: boolean;
  phaseStatus: string;
  isDone: boolean;
  lock: { message: string } | null;
}

export interface ItemToggleState {
  disabled: boolean;
  /** Por qué no se puede: va en el `title` del botón. */
  reason: string | null;
}

export const CLOSED_PHASE_UNCHECK_REASON = "En una fase cerrada no se destilda";

export function itemToggleState({ canItems, phaseStatus, isDone, lock }: ItemToggleInput): ItemToggleState {
  if (!canItems) return { disabled: true, reason: null };
  if (isDone) {
    return phaseStatus === "completed" ? { disabled: true, reason: CLOSED_PHASE_UNCHECK_REASON } : { disabled: false, reason: null };
  }
  if (lock) return { disabled: true, reason: lock.message };
  return { disabled: false, reason: null };
}
