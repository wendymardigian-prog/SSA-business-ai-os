/**
 * Como se llama a una funcion SQL sin que un error se vea como un cero.
 *
 * `blockResult` envuelve la llamada entera: si PostgREST devuelve `error`, si la
 * promesa se rompe o si tarda demasiado, el bloque queda en `ok: false` con un
 * motivo en castellano. **Nunca lanza**, y eso es lo que permite pasarle la
 * promesa al navegador y leerla con `use()` sin romper la hidratacion.
 */

import type { BlockResult } from "./types";

/** Un bloque que tarda mas que esto se da por caido: la respuesta no se puede quedar abierta. */
export const BLOCK_TIMEOUT_MS = 15_000;

export function ok<T>(data: T, loadedAt: string = new Date().toISOString()): BlockResult<T> {
  return { ok: true, data, loadedAt };
}

export function fail<T>(error: string): BlockResult<T> {
  return { ok: false, error };
}

/** El mensaje de un error, sin filtrar datos sensibles ni un objeto entero. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Error inesperado";
}

/**
 * Corre la carga de un bloque y la convierte en un resultado.
 *
 * `load` puede lanzar, devolver `{ error }` de PostgREST o colgarse: las tres
 * terminan en `ok: false`.
 */
export async function blockResult<T>(
  label: string,
  load: () => Promise<{ data: T } | { error: string }>,
  timeoutMs: number = BLOCK_TIMEOUT_MS,
): Promise<BlockResult<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<{ error: string }>((resolve) => {
      timer = setTimeout(() => resolve({ error: "tardó demasiado en responder" }), timeoutMs);
    });
    const result = await Promise.race([load(), timeout]);
    if ("error" in result) return fail(`No pudimos cargar ${label}: ${result.error}`);
    return ok(result.data);
  } catch (err) {
    console.error(`[dashboard-chat] ${label}:`, errorMessage(err));
    return fail(`No pudimos cargar ${label}.`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Traduce la respuesta de un `rpc` a lo que espera `blockResult`. */
export function fromRpc<Row, T>(
  res: { data: unknown; error: { message: string } | null },
  map: (rows: Row[]) => T,
): { data: T } | { error: string } {
  if (res.error) return { error: res.error.message };
  const rows = (res.data ?? []) as Row[];
  return { data: map(Array.isArray(rows) ? rows : ([rows] as Row[])) };
}
