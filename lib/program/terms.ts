// @plantilla-quitar(servicios)
/**
 * Los términos al entrar (F113), puro. Gemela de `app_servicio.portal_terms_plan(jsonb)` (00345); los casos de
 * `terms.cases.json` corren contra las dos. Se piden si el producto los tiene prendidos con un formulario y alguna
 * de las variantes vigentes de la persona los pide; quedan aceptados con una respuesta de ese formulario (de la
 * versión publicada si «pedirlos de nuevo si cambian»).
 */
export interface TermsInput {
  enabled: boolean;
  formId: string | null;
  askAgainOnChange: boolean;
  /** `ask_terms` de cada variante vigente de la persona en este producto (por defecto true). */
  variantsAsk: boolean[];
  /** Las versiones del formulario que la persona aceptó. */
  acceptedVersionIds: string[];
  /** La versión publicada hoy. */
  currentVersionId: string | null;
}

export function termsPending(i: TermsInput): boolean {
  if (!i.enabled || !i.formId) return false;
  if (!i.variantsAsk.some(Boolean)) return false;
  if (i.acceptedVersionIds.length === 0) return true;
  if (i.askAgainOnChange && i.currentVersionId && !i.acceptedVersionIds.includes(i.currentVersionId)) return true;
  return false;
}
