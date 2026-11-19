/**
 * La firma de la «Llamada HTTP» de una automatización (traída de RER, B-AUT-21). Pura: la usa el nodo para firmar y
 * quien recibe (y los tests) para comprobar.
 *
 * El formato es el habitual de los webhooks firmados:
 * - `X-Webhook-Id`: un id estable por paso de una ejecución. Si el mismo paso se vuelve a mandar (un reintento), lleva
 *   el mismo id: quien recibe lo usa para no procesarlo dos veces.
 * - `X-Webhook-Timestamp`: la hora del envío en segundos (unix). Quien recibe rechaza una firma vieja (repetición).
 * - `X-Webhook-Signature`: `v1=<hex>`, el HMAC-SHA256 con la clave del negocio de `<id>.<timestamp>.<cuerpo>`.
 *
 * La clave vive en la bóveda (Vault, `automation_webhook_secret`) y nunca sale de ahí: esta función la recibe del
 * servidor y no la guarda. La guía para quien recibe está en docs/flow-registry.md.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TOLERANCE_SECONDS,
} from "./webhook-signature-constants";

export { WEBHOOK_ID_HEADER, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER, WEBHOOK_TOLERANCE_SECONDS };
export { WEBHOOK_SECRET_MIN_LENGTH, webhookSecretProblem } from "./webhook-signature-constants";

function digest(secret: string, id: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("hex");
}

/** Los tres headers de un envío firmado. */
export function signWebhook(secret: string, id: string, body: string, timestamp: number): Record<string, string> {
  return {
    [WEBHOOK_ID_HEADER]: id,
    [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
    [WEBHOOK_SIGNATURE_HEADER]: `v1=${digest(secret, id, timestamp, body)}`,
  };
}

/** El id de un envío: el mismo para el mismo paso de la misma ejecución (un reintento se reconoce). */
export function webhookDeliveryId(sessionId: string, nodeId: string): string {
  return `${sessionId}:${nodeId}`;
}

export type WebhookCheck = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

/**
 * Lo que hace quien recibe: comprueba la firma en tiempo constante y que no sea vieja. `headers` con los nombres en
 * minúscula o como vengan; `now` en segundos.
 */
export function verifyWebhook(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  body: string,
  now: number,
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
): WebhookCheck {
  const get = (name: string) => {
    const found = Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
    return Array.isArray(found) ? found[0] : found;
  };
  const id = get(WEBHOOK_ID_HEADER);
  const ts = Number(get(WEBHOOK_TIMESTAMP_HEADER));
  const sig = get(WEBHOOK_SIGNATURE_HEADER);
  if (!id || !Number.isFinite(ts) || !sig?.startsWith("v1=")) return { ok: false, reason: "missing" };
  if (Math.abs(now - ts) > toleranceSeconds) return { ok: false, reason: "stale" };
  const expected = Buffer.from(digest(secret, id, ts, body), "hex");
  const given = Buffer.from(sig.slice(3), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
