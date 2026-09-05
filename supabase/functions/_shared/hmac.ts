/**
 * Verificacion de firma HMAC-SHA256 (webhooks de Zernio).
 *
 * Misma logica que verifyWebhookSignature en lib/zernio-webhook.ts, portada a
 * Web Crypto porque en Deno no hay node:crypto disponible igual. La comparacion
 * es de tiempo constante: comparar con === filtra el secreto byte a byte.
 */

const encoder = new TextEncoder();

export async function verifyHmacSignature(
  secret: string,
  body: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(signature, expected);
}

/** Comparacion de tiempo constante entre dos strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
