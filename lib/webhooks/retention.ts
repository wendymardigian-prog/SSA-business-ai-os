/**
 * Retencion de los envios (F7): el payload se vacia a los 90 dias y la fila se
 * conserva 12 meses (365 dias); despues se borra.
 *
 * Tiron 2, C4: el payload no vive solo en `inbound_webhooks`. El flujo guarda una COPIA en
 * `flow_sessions.variables.webhook` (`payload` y `query`, para que sobreviva a un «Esperar») y el job
 * `resume_flow` lleva otra en `payload.variables.webhook`. Vaciar solo la fila dejaba los datos personales
 * del envio vivos para siempre en esas dos copias: a los mismos 90 dias se vacian tambien (las de las
 * sesiones y jobs YA TERMINADOS; una sesion que sigue esperando todavia las necesita).
 */
export const CLEAR_PAYLOAD_AFTER_DAYS = 90;
export const DELETE_AFTER_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionAction = "keep" | "clear_payload" | "delete";

export function retentionAction(receivedAt: string | Date, now: Date): RetentionAction {
  const received = new Date(receivedAt).getTime();
  if (!Number.isFinite(received)) return "keep";
  const days = Math.floor((now.getTime() - received) / DAY_MS);
  if (days > DELETE_AFTER_DAYS) return "delete";
  if (days >= CLEAR_PAYLOAD_AFTER_DAYS) return "clear_payload";
  return "keep";
}

/** Las fechas de corte para las consultas del barrido. */
export function retentionCutoffs(now: Date): { clearBefore: string; deleteBefore: string } {
  return {
    clearBefore: new Date(now.getTime() - CLEAR_PAYLOAD_AFTER_DAYS * DAY_MS).toISOString(),
    deleteBefore: new Date(now.getTime() - (DELETE_AFTER_DAYS + 1) * DAY_MS).toISOString(),
  };
}

/** Las sesiones que ya no van a retomarse: solo de ellas se vacia la copia del envio. */
export const FINISHED_SESSION_STATUSES = ["completed", "cancelled", "expired"] as const;
/** Los jobs `resume_flow` que ya no van a correr. */
export const FINISHED_JOB_STATUSES = ["completed", "failed", "cancelled"] as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Vacio = ausente o `{}`. Todo lo demas (incluso un texto o una lista, que no deberia estar) es una copia por vaciar. */
const isEmpty = (value: unknown): boolean => value === undefined || value === null || (isObject(value) && Object.keys(value).length === 0);

export interface StripResult<T = unknown> {
  value: T;
  /** false = no habia nada que vaciar: no hace falta escribir. */
  changed: boolean;
}

/**
 * `variables` de una sesion de flujo sin la copia del envio: `variables.webhook.payload` y `.query` pasan a `{}`
 * (lo que `webhookVariables` ya pone cuando no hay datos). Lo demas del envio (id, endpoint, fecha, numero de
 * reproceso) y todas las otras variables quedan igual. Puro: no muta lo que recibe.
 */
export function stripWebhookCopies(variables: unknown): StripResult {
  if (!isObject(variables) || !isObject(variables.webhook)) return { value: variables, changed: false };
  const webhook = variables.webhook;
  if (isEmpty(webhook.payload) && isEmpty(webhook.query)) return { value: variables, changed: false };
  return { value: { ...variables, webhook: { ...webhook, payload: {}, query: {} } }, changed: true };
}

/** El `payload` de un job `resume_flow` (que lleva `variables`) sin la copia del envio. Puro. */
export function stripJobPayloadCopies(payload: unknown): StripResult {
  if (!isObject(payload) || !("variables" in payload)) return { value: payload, changed: false };
  const stripped = stripWebhookCopies(payload.variables);
  if (!stripped.changed) return { value: payload, changed: false };
  return { value: { ...payload, variables: stripped.value }, changed: true };
}
