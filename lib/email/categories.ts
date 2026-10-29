/**
 * La categoria de un email (suscripcion a emails, E2): marketing o transaccional.
 *
 * Marketing respeta la baja: no sale a una direccion dada de baja o con queja, y
 * lleva el pie y las cabeceras de baja. Transaccional es lo que la persona pidio
 * (una reunion, un contrato, una respuesta): sale igual, salvo que la direccion
 * rebote. Modulo puro: lo usan el motor, las secuencias y las pantallas.
 */

import type { EmailCategory } from "./subscription";

export const EMAIL_CATEGORY_LABELS: Record<EmailCategory, string> = {
  marketing: "Marketing",
  transactional: "Transaccional",
};

export const EMAIL_CATEGORY_HINTS: Record<EmailCategory, string> = {
  marketing: "Promociones, novedades, seguimientos. No le llega a quien se dio de baja y lleva el link para darse de baja.",
  transactional: "Lo que la persona pidió: confirmaciones de agenda, contratos, compras. Le llega aunque se haya dado de baja de marketing.",
};

export function isEmailCategory(value: unknown): value is EmailCategory {
  return value === "marketing" || value === "transactional";
}

/** Lo que importa de un flujo para saber de donde salio. */
export interface FlowOriginRow {
  form_id?: string | null;
  event_type_id?: string | null;
  template_key?: string | null;
}

/**
 * La categoria de un paso de email que no la guarda: transaccional en los flujos
 * de agenda, formularios, contratos y los del sistema (cobranza), y en cualquier
 * flujo que arranco por una reunion; marketing en los que arma una persona. Asi
 * los flujos que ya existian no cambian de comportamiento para lo que la persona
 * pidio. Sin poder leer el flujo, marketing (no mandarle a alguien dado de baja).
 */
export function defaultFlowEmailCategory(flow: FlowOriginRow | null, opts: { fromBooking?: boolean } = {}): EmailCategory {
  if (opts.fromBooking) return "transactional";
  if (!flow) return "marketing";
  if (flow.event_type_id || flow.form_id || flow.template_key) return "transactional";
  return "marketing";
}

/** La categoria efectiva de un paso: la que eligio la persona, o la de su flujo. */
export function stepEmailCategory(stored: unknown, flow: FlowOriginRow | null, opts: { fromBooking?: boolean } = {}): EmailCategory {
  return isEmailCategory(stored) ? stored : defaultFlowEmailCategory(flow, opts);
}

/** La categoria de un paso de secuencia: la que eligio la persona, o marketing. */
export function sequenceStepEmailCategory(stored: unknown): EmailCategory {
  return isEmailCategory(stored) ? stored : "marketing";
}
