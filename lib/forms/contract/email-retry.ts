/**
 * Reintentos del email con la copia del contrato (F28). PURO. Portado de
 * `email-retry-utils.ts` de prevxcrm: lo transitorio se reintenta a los 5, 15 y
 * 30 minutos; lo permanente (un 4xx que no sea 429) no.
 *
 * Los reintentos los agenda el HANDLER (`scheduleJob`), no la cola: si lanzara, la
 * cola reintentaría a los 10 segundos encima de la espera propia.
 */

export type EmailErrorKind = "transient" | "permanent";

const TRANSIENT_PATTERNS = ["timeout", "connection", "fetch failed", "network", "broken pipe", "econnreset", "econnrefused", "socket hang up", "rate limit", "throttl"];

/**
 * @param status el estado HTTP del proveedor (0 si no hubo respuesta)
 * @param message el texto del error
 */
export function classifyEmailError(status: number, message: string): EmailErrorKind {
  if (status === 429) return "transient";
  if (status >= 500) return "transient";
  if (status >= 400 && status < 500) return "permanent";
  const lower = message.toLowerCase();
  if (TRANSIENT_PATTERNS.some((p) => lower.includes(p))) return "transient";
  // Sin estado y sin pista: es más seguro reintentar que perder la copia.
  return "transient";
}

/** Minutos de espera antes de cada reintento. */
export const EMAIL_RETRY_MINUTES = [5, 15, 30] as const;
export const MAX_EMAIL_RETRIES = EMAIL_RETRY_MINUTES.length;

/** Cuándo vuelve a intentarse después de `attempt` reintentos ya hechos (0 = el primer fallo). `null` si ya no quedan. */
export function nextEmailRetryAt(attempt: number, now: Date = new Date()): Date | null {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= MAX_EMAIL_RETRIES) return null;
  return new Date(now.getTime() + EMAIL_RETRY_MINUTES[attempt] * 60_000);
}

/** La clave de idempotencia del job de un intento (`contract_email:<firma>:<intento>`). */
export function emailJobKey(signatureId: string, attempt: number | string): string {
  return `contract_email:${signatureId}:${attempt}`;
}
