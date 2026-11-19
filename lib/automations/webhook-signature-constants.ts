/** Lo de la firma de la «Llamada HTTP» que también usa la pantalla (sin `node:crypto`). */
export const WEBHOOK_SECRET_MIN_LENGTH = 16;
export const WEBHOOK_SECRET_MAX_LENGTH = 256;
export const WEBHOOK_ID_HEADER = "X-Webhook-Id";
export const WEBHOOK_TIMESTAMP_HEADER = "X-Webhook-Timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "X-Webhook-Signature";
/** Cuánto vale una firma, en segundos, para quien recibe. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** El problema de una clave que alguien quiere guardar, o null si sirve. */
export function webhookSecretProblem(secret: string): string | null {
  const value = secret.trim();
  if (value.length < WEBHOOK_SECRET_MIN_LENGTH) return `La clave tiene que tener al menos ${WEBHOOK_SECRET_MIN_LENGTH} caracteres.`;
  if (value.length > WEBHOOK_SECRET_MAX_LENGTH) return `La clave es demasiado larga (máximo ${WEBHOOK_SECRET_MAX_LENGTH} caracteres).`;
  if (/\s/.test(value)) return "La clave no puede tener espacios.";
  return null;
}
