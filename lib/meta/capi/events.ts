/**
 * Qué eventos de la API de Conversiones se pueden mandar y cómo se llama cada uno en pantalla. Puro y sin servidor: lo
 * importan el editor de pasos y el lienzo (navegador) y el armado del evento (servidor).
 */

/** Los eventos estándar que ofrece el paso «Enviar evento a Meta». La compra (Purchase) no: es automática. */
export const STEP_META_EVENTS = [
  { name: "Lead", label: "Lead (cliente potencial)" },
  { name: "Schedule", label: "Schedule (agendó una reunión)" },
  { name: "CompleteRegistration", label: "CompleteRegistration (se registró)" },
  { name: "SubmitApplication", label: "SubmitApplication (envió una solicitud)" },
  { name: "Contact", label: "Contact (se contactó)" },
] as const;

export const PURCHASE_EVENT = "Purchase";

/** Un nombre propio (evento personalizado): letras, números, espacios y «_», hasta 50, empezando con una letra. */
export const CUSTOM_EVENT_RE = /^[A-Za-z][A-Za-z0-9_ ]{0,49}$/;

export function isStepEventName(name: string): boolean {
  return STEP_META_EVENTS.some((e) => e.name === name);
}

/** El nombre que se manda, o el motivo por el que no sirve. Purchase no se ofrece en el paso: lo manda cada pago. */
export function checkStepEventName(name: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) return { ok: false, error: "Elegí qué evento se manda a Meta." };
  if (value === PURCHASE_EVENT) return { ok: false, error: "La compra (Purchase) se manda sola con cada pago cobrado: elegí otro evento." };
  if (isStepEventName(value) || CUSTOM_EVENT_RE.test(value)) return { ok: true, name: value };
  return { ok: false, error: "El nombre del evento solo puede tener letras, números, espacios y «_» (hasta 50)." };
}

/** Monedas que ofrece el paso. Meta acepta cualquier código ISO 4217; estas son las de la región. */
export const META_CURRENCIES = ["USD", "ARS", "MXN", "COP", "CLP", "PEN", "UYU", "BRL", "EUR"] as const;

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

/** Lo que guarda el paso en el lienzo (`data` del nodo). */
export interface MetaEventStepData {
  actionType?: "send_meta_event";
  eventName?: string;
  /** Un número o una variable (`{{answer.presupuesto}}`). Vacío = sin valor. */
  value?: string;
  currency?: string;
  /** Vacío = el nombre del formulario o de la reunión. */
  contentName?: string;
  /** Solo reuniones que agendó el lead (página pública o embed). Prendido por defecto. */
  onlyLeadBookings?: boolean;
  label?: string;
}

export const SEND_META_EVENT_TYPE = "send_meta_event";

/** Por qué un evento no se mandó (`meta_capi_events.skip_reason`), en palabras para la tarjeta y el historial. */
export type SkipReason = "too_old" | "no_match_data" | "spam" | "not_lead_booking" | "no_contact" | "source_missing" | "invalid" | "not_configured";

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  too_old: "Pasaron más de 7 días: Meta ya no lo acepta.",
  no_match_data: "No hay datos de la persona (email, teléfono o cookies de Meta) para que Meta la reconozca.",
  spam: "La respuesta está marcada como spam.",
  not_lead_booking: "La reunión no la agendó el lead (la armó el equipo o el agente).",
  no_contact: "No hay un contacto vinculado.",
  source_missing: "Ya no existe lo que disparó el evento.",
  invalid: "El evento no está bien configurado.",
  not_configured: "La API de Conversiones no está configurada (falta el Pixel o el token).",
};
