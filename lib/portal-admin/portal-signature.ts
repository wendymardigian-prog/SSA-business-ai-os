// @plantilla-quitar(servicios)
/**
 * La firma de los pedidos del portal de estudiantes a SSA (Corrida B2). El portal no tiene llaves de Supabase ni de
 * Resend: cuando necesita que SSA haga algo (mandar el código para entrar), firma el pedido con el secreto que
 * comparten los dos servicios (`PORTAL_SHARED_SECRET`, en las variables de Railway de cada uno).
 *
 *   firma = hex(HMAC-SHA256(secreto, `${timestamp}.${body}`))      headers: x-portal-timestamp, x-portal-signature
 *
 * Se rechaza una firma de más de 5 minutos (o del futuro) para que un pedido copiado no se pueda repetir después.
 * Puro (el reloj entra como parámetro).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const PORTAL_SIGNATURE_MAX_AGE_MS = 5 * 60_000;

export function signPortalRequest(secret: string, timestampMs: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestampMs}.${body}`).digest("hex");
}

export function verifyPortalRequest(input: { secret: string | undefined; timestamp: string | null; signature: string | null; body: string; nowMs: number }): boolean {
  const { secret, timestamp, signature, body, nowMs } = input;
  if (!secret || secret.length < 32 || !timestamp || !signature || !/^\d{10,16}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const ts = Number(timestamp);
  if (Math.abs(nowMs - ts) > PORTAL_SIGNATURE_MAX_AGE_MS) return false;
  const expected = Buffer.from(signPortalRequest(secret, ts, body), "hex");
  const got = Buffer.from(signature, "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}
