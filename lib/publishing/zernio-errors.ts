/**
 * Los errores de Zernio, bien clasificados (A12).
 *
 * El SDK **lanza**: tiene un interceptor de respuesta que convierte todo
 * HTTP no-2xx en un `ZernioApiError` antes de que el llamador vea el
 * `{ data, error }`. Por eso el bloque `if (error)` que habia en el
 * publicador era codigo muerto, y ademas leia `.status` cuando la clase
 * expone `.statusCode`.
 *
 * El resultado practico: **ningun 429 ni 5xx se reintentaba**. Todos
 * terminaban como fallo permanente, que es lo que devuelve
 * `(undefined ?? 0) >= 500`.
 *
 * Aca no se importa la clase del SDK: alcanza con mirar la forma. Asi el
 * modulo se prueba sin el SDK y no depende de como lo empaquete su version.
 */

import { PublishError } from "@/lib/jobs/errors";

interface ZernioLikeError {
  statusCode?: number;
  status?: number;
  code?: string;
  message?: string;
}

/** El codigo HTTP de un error del SDK, mire donde mire. */
export function zernioStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as ZernioLikeError & { response?: { status?: number } };
  return e.statusCode ?? e.status ?? e.response?.status;
}

/**
 * Si conviene volver a intentar.
 *
 * - 429 y 5xx: si. Es el proveedor, no la publicacion.
 * - 409: si. Es el dedupe de contenido de Zernio contestando que ya hay un
 *   post igual en las ultimas 24 horas; el llamador lo trata aparte.
 * - El resto: no. La red rechazo el contenido y reintentar lo va a rechazar
 *   igual.
 */
export function isTemporaryZernioStatus(status: number | undefined): boolean {
  if (status === undefined) return true; // Sin codigo: fue de red.
  return status === 429 || status === 409 || status >= 500;
}

/** Que un error del SDK se lea como el resto de los errores de publicacion. */
export function classifyZernioError(err: unknown, fallback: string): PublishError {
  if (err instanceof PublishError) return err;

  const status = zernioStatus(err);
  const message =
    (err as ZernioLikeError | null)?.message?.trim() || fallback;

  return new PublishError(
    message,
    isTemporaryZernioStatus(status) ? "temporary" : "permanent",
    status,
  );
}

/**
 * Si Zernio contesto "esto ya lo publicaste".
 *
 * Su dedupe por contenido rechaza con 409 un post igual dentro de las 24
 * horas, y devuelve el id del que ya existe. Tratarlo como fallo seria
 * mentir: el post esta publicado.
 */
export function existingPostIdFrom(err: unknown): string | null {
  if (zernioStatus(err) !== 409) return null;
  const details = (err as { details?: Record<string, unknown> } | null)?.details;
  const id = details?.existingPostId ?? details?.existing_post_id;
  return typeof id === "string" && id ? id : null;
}
