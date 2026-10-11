/**
 * Cloudflare Turnstile, del lado del servidor (F11). SOLO servidor.
 *
 * Cada envío público se verifica acá con la secret key del workspace (que vive
 * en Vault y nunca vuelve al navegador). Reglas:
 *  - NUNCA lanza: devuelve `{ ok: false, codes }`.
 *  - Si Cloudflare no responde (red, timeout, respuesta rota) el resultado es
 *    `codes: ["network"]` y el envío responde 503. Jamás se acepta un envío sin
 *    verificar.
 *  - Se manda `idempotency_key`: así un reintento legítimo del mismo envío no
 *    falla porque el token ya se consumió (D11).
 *  - La secret key no se loguea.
 */
import type { FetchLike } from "@/lib/oauth/types";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

export type TurnstileResult = { ok: true } | { ok: false; codes: string[] };

export interface VerifyInput {
  secret: string;
  token: string;
  ip?: string | null;
  idempotencyKey?: string | null;
  fetchImpl?: FetchLike;
}

interface SiteverifyResponse {
  success?: boolean;
  "error-codes"?: string[];
}

async function callSiteverify(
  params: URLSearchParams,
  fetchImpl: FetchLike,
): Promise<{ ok: true; body: SiteverifyResponse } | { ok: false }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false };
    const body = (await response.json()) as SiteverifyResponse;
    if (!body || typeof body !== "object") return { ok: false };
    return { ok: true, body };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyTurnstile(input: VerifyInput): Promise<TurnstileResult> {
  const params = new URLSearchParams();
  params.set("secret", input.secret);
  params.set("response", input.token);
  if (input.ip) params.set("remoteip", input.ip);
  if (input.idempotencyKey) params.set("idempotency_key", input.idempotencyKey);

  const result = await callSiteverify(params, input.fetchImpl ?? fetch);
  if (!result.ok) return { ok: false, codes: ["network"] };

  if (result.body.success === true) return { ok: true };
  const codes = Array.isArray(result.body["error-codes"]) ? result.body["error-codes"] : [];
  return { ok: false, codes: codes.length > 0 ? codes : ["unknown"] };
}

export type SecretCheck = { ok: true } | { ok: false; error: string };

/**
 * "Probar y guardar": ¿Cloudflare reconoce esta secret key? Se le manda un token
 * de prueba que nunca es válido; lo que importa es QUÉ error devuelve:
 *  - `invalid-input-secret`  → la clave no es válida.
 *  - `invalid-input-response` / `missing-input-response` → reconoció la clave y
 *    rechazó el token de prueba: la clave existe.
 *  - `success` → las claves de prueba oficiales de Cloudflare (siempre aprueban).
 */
export async function checkTurnstileSecret(secret: string, fetchImpl?: FetchLike): Promise<SecretCheck> {
  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", "prueba-de-conexion");

  const result = await callSiteverify(params, fetchImpl ?? fetch);
  if (!result.ok) return { ok: false, error: "No pude comunicarme con Cloudflare. Probá de nuevo en un momento." };

  if (result.body.success === true) return { ok: true };
  const codes = Array.isArray(result.body["error-codes"]) ? result.body["error-codes"] : [];
  if (codes.includes("invalid-input-secret")) return { ok: false, error: "La secret key no es válida" };
  if (codes.includes("invalid-input-response") || codes.includes("missing-input-response")) return { ok: true };
  return { ok: false, error: "Cloudflare no reconoció la secret key" };
}
