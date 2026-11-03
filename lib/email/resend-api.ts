/**
 * Una llamada a la API de Resend, con los errores clasificados (conexion de Resend).
 *
 * Lo comparten la prueba de la key, el webhook y el estado de la tarjeta. Nunca lanza: devuelve QUE paso, y quien
 * llama decide que decir. La key nunca sale de aca (ni en un log ni en un error).
 *
 * Solo servidor.
 */

export const RESEND_API = "https://api.resend.com";
const TIMEOUT_MS = 10_000;

/**
 * - `restricted`: la key es de "solo envio" (401 `restricted_api_key`): manda emails pero no lista ni administra.
 * - `invalid_key`: la key no sirve (otro 400/401/403: revocada, mal copiada, desactivada).
 * - `failed`: la red, un 5xx, un 429 o una respuesta que no se entiende. No dice nada de la key.
 */
export type ResendApiFailure = "restricted" | "invalid_key" | "failed";

export type ResendApiResult<T> = { ok: true; data: T } | { ok: false; reason: ResendApiFailure; status: number | null };

export async function resendRequest<T>(
  apiKey: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<ResendApiResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(`${RESEND_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "failed", status: null };
  }

  const json = (await res.json().catch(() => null)) as (T & { name?: string }) | null;
  if (res.ok) {
    if (json === null) return { ok: false, reason: "failed", status: res.status };
    return { ok: true, data: json as T };
  }
  return { ok: false, reason: classifyResendFailure(res.status, json?.name), status: res.status };
}

/** Puro: que significa un error de Resend. */
export function classifyResendFailure(status: number, name: string | null | undefined): ResendApiFailure {
  // 401 restricted_api_key = solo envio. El 403 con el mismo nombre es "key desactivada": esa SI es invalida.
  if (status === 401 && name === "restricted_api_key") return "restricted";
  if (status === 400 || status === 401 || status === 403) return "invalid_key";
  return "failed";
}

export type ResendKeyAccess = "full" | "sending";

/**
 * Que puede la key: `GET /domains` responde a una de acceso completo y da 401 `restricted_api_key` a una de solo
 * envio. Es una lectura: no crea ni cambia nada en la cuenta.
 */
export async function probeResendKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; access: ResendKeyAccess } | { ok: false; reason: "invalid_key" | "failed" }> {
  const res = await resendRequest<unknown>(apiKey, "GET", "/domains", undefined, fetchImpl);
  if (res.ok) return { ok: true, access: "full" };
  if (res.reason === "restricted") return { ok: true, access: "sending" };
  return { ok: false, reason: res.reason };
}
