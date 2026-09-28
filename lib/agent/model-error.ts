import { APICallError } from "ai";

/**
 * Que fue lo que dijo el proveedor cuando fallo la llamada al modelo.
 *
 * Antes se guardaba solo `err.name`, que para cualquier fallo de HTTP es
 * siempre el mismo string: "AI_APICallError". En la pantalla de runs eso se
 * leia como "primary: AI_APICallError; fallback: AI_APICallError", que no
 * distingue una key revocada de un modelo inexistente, de un tope de uso, ni
 * de un proveedor caido. Costo medio dia de diagnostico averiguar que era un
 * 401.
 *
 * Lo que SI se guarda: el codigo HTTP y el tipo de error que declara el
 * proveedor (`authentication_error`, `not_found_error`, ...). Los dos son
 * campos cortos y cerrados.
 *
 * Lo que NUNCA se guarda: el `message` del proveedor. Algunos repiten parte
 * del pedido en el error, y el pedido lleva el texto del lead. Un mensaje de
 * error termina en un log, en una notificacion y en la pantalla; el texto de
 * un lead no puede viajar en ninguno de los tres.
 *
 * Sin dependencias de servidor mas alla del SDK: es una funcion pura.
 */

export interface ModelFailure {
  /** Corto y estable, para guardar: "api_401:authentication_error", "timeout". */
  code: string;
  /** El codigo HTTP, si lo hubo. */
  status: number | null;
  /** El tipo que declara el proveedor. Null si no vino o no se pudo leer. */
  providerType: string | null;
  /** Un 401/403: la key no sirve. Reintentar con otro modelo del mismo proveedor es al pedo. */
  isAuth: boolean;
  isTimeout: boolean;
}

/** Un abort o un timeout. Se mira el nombre y, como ultimo recurso, el mensaje. */
export function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  return /abort|timeout/i.test(err.message);
}

export function classifyModelError(err: unknown): ModelFailure {
  if (isTimeoutError(err)) {
    return { code: "timeout", status: null, providerType: null, isAuth: false, isTimeout: true };
  }

  if (APICallError.isInstance(err)) {
    const status = typeof err.statusCode === "number" ? err.statusCode : null;
    const providerType = readProviderType(err.responseBody);
    const isAuth = status === 401 || status === 403;
    const code = status
      ? `api_${status}${providerType ? `:${providerType}` : ""}`
      : err.name || "error";
    return { code, status, providerType, isAuth, isTimeout: false };
  }

  // Cualquier otra cosa: el nombre de la clase es lo unico confiable.
  const name = err instanceof Error ? err.name || "error" : "error";
  return { code: name, status: null, providerType: null, isAuth: false, isTimeout: false };
}

/**
 * El tipo de error que declara el proveedor, del cuerpo de la respuesta.
 *
 * Cada uno lo pone en un lugar distinto:
 *   Anthropic -> { error: { type: "authentication_error" } }
 *   OpenAI    -> { error: { code: "invalid_api_key", type: "invalid_request_error" } }
 *   Google    -> { error: { status: "UNAUTHENTICATED" } }
 *
 * Se lee SOLO ese campo. El `message` no se toca nunca.
 */
function readProviderType(responseBody: string | undefined): string | null {
  if (!responseBody) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return null;
  }

  const root = asObject(parsed);
  const error = asObject(root.error);

  const candidate = error.code ?? error.type ?? error.status;
  if (typeof candidate !== "string") return null;

  const clean = candidate.trim();
  if (!clean) return null;
  // Acotado y sin espacios: esto se guarda y se muestra, no es texto libre.
  return clean.slice(0, 60).replace(/\s+/g, "_");
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
