/**
 * Los dos triggers de Llamadas (F32) y sus filtros, como funciones puras.
 *
 * El registro (`lib/flow-engine/registry/call-triggers.ts`) los declara; la
 * logica de "¿este evento le corresponde a este trigger?" vive aca para
 * probarla sin base ni cron.
 *
 *   call_analyzed  una llamada CON CONTACTO queda analizada (analisis nuevo o
 *                  regenerado; una correccion a mano NO lo dispara).
 *   call_linked    se vincula un contacto a una llamada (automatico o a mano).
 *
 * Una llamada sin contacto no emite nada (`automation_events.contact_id` es
 * obligatorio): cuando despues se vincula, emite `call_linked`.
 */

export const CALL_TRIGGER_TYPES = ["call_analyzed", "call_linked"] as const;
export type CallTriggerType = (typeof CALL_TRIGGER_TYPES)[number];

export const CALL_TRIGGER_LABELS: Record<CallTriggerType, string> = {
  call_analyzed: "Se analizó una llamada",
  call_linked: "Se vinculó una llamada",
};

export function isCallTriggerType(value: unknown): value is CallTriggerType {
  return typeof value === "string" && (CALL_TRIGGER_TYPES as readonly string[]).includes(value);
}

/** Lo que el evento de automatizacion trae de la llamada. */
export interface CallEventPayload {
  call_id: string;
  call_type: string | null;
  outcome: string | null;
  closer_score: number | null;
  lead_score: number | null;
  lead_qualification: string | null;
  closer_id: string | null;
  booking_id: string | null;
  [key: string]: unknown;
}

/** La configuracion del trigger, tal como la guarda el editor. Vacio = cualquiera, nunca "ninguno". */
export interface CallTriggerConfig {
  call_types?: string[] | null;
  /** Solo `call_analyzed`. */
  outcomes?: string[] | null;
  closer_ids?: string[] | null;
  closer_score_min?: number | null;
  closer_score_max?: number | null;
  lead_score_min?: number | null;
  lead_score_max?: number | null;
  qualifications?: string[] | null;
}

function listMatches(allowed: string[] | null | undefined, actual: string | null | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  return typeof actual === "string" && allowed.includes(actual);
}

/** Un rango sobre un puntaje. Sin limites vale todo; con un limite, una llamada SIN puntaje no entra. */
function inRange(min: number | null | undefined, max: number | null | undefined, actual: number | null | undefined): boolean {
  const hasMin = typeof min === "number" && Number.isFinite(min);
  const hasMax = typeof max === "number" && Number.isFinite(max);
  if (!hasMin && !hasMax) return true;
  if (typeof actual !== "number" || !Number.isFinite(actual)) return false;
  if (hasMin && actual < min!) return false;
  if (hasMax && actual > max!) return false;
  return true;
}

export function callEventMatches(type: string, config: CallTriggerConfig, payload: CallEventPayload): boolean {
  if (!listMatches(config.call_types, payload.call_type)) return false;
  if (!listMatches(config.closer_ids, payload.closer_id)) return false;
  if (type === "call_analyzed") {
    if (!listMatches(config.outcomes, payload.outcome)) return false;
    if (!listMatches(config.qualifications, payload.lead_qualification)) return false;
    if (!inRange(config.closer_score_min, config.closer_score_max, payload.closer_score)) return false;
    if (!inRange(config.lead_score_min, config.lead_score_max, payload.lead_score)) return false;
  }
  return true;
}

/**
 * La clave de idempotencia del disparo (`trigger_fires`):
 * `call:<callId>:<tipo>:<corrida o contacto>`. Un analisis regenerado tiene
 * otra corrida y vuelve a disparar; el mismo evento procesado dos veces, no.
 */
export function callDedupeKey(type: string, callId: string, discriminator: string): string {
  return `call:${callId}:${type}:${discriminator}`;
}

export interface CallForEvent {
  id: string;
  contact_id: string | null;
  call_type: string | null;
  outcome: string | null;
  closer_score: number | null;
  lead_score: number | null;
  lead_qualification: string | null;
  recorded_by_user_id: string | null;
  booking_id: string | null;
  analysis_run_id?: string | null;
}

export function callEventPayload(call: CallForEvent): CallEventPayload {
  return {
    call_id: call.id,
    call_type: call.call_type,
    outcome: call.outcome,
    closer_score: call.closer_score,
    lead_score: call.lead_score,
    lead_qualification: call.lead_qualification,
    closer_id: call.recorded_by_user_id,
    booking_id: call.booking_id,
    // Para la clave de idempotencia: el analisis (o el contacto) que origino el evento.
    ...(call.analysis_run_id ? { analysis_run_id: call.analysis_run_id } : {}),
  };
}
