// @plantilla-quitar(servicios)
/**
 * Llamar a las funciones del modulo (esquema `app_servicio`) desde el servidor.
 *
 * Los tipos generados de Supabase cubren solo `public`: el esquema del modulo se llama sin tipos y cada
 * accion valida lo que vuelve. Las funciones piden su clave adentro (con la sesion del usuario) y
 * devuelven errores con codigo propio (SVxxx, ACxxx, ...) y un texto en castellano listo para mostrar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type AnyClient = SupabaseClient<any, any, any>;

export interface SvcError {
  code: string | null;
  message: string;
  /** El `DETAIL` de la base (por ejemplo, el id del servicio que ya existe en SV013). */
  detail: string | null;
}

export type SvcResult<T> = { ok: true; data: T } | { ok: false; error: SvcError };

/** El esquema del modulo, con cualquier cliente de Supabase (el del usuario o el de servicio). */
export function svcSchema(client: unknown) {
  return (client as AnyClient).schema("app_servicio");
}

/** Mensaje para mostrar: el de la base si es nuestro (codigo de 5 letras y numeros), si no uno generico. */
export function svcErrorMessage(error: { code?: string | null; message?: string | null } | null | undefined): string {
  if (!error) return "No se pudo hacer";
  const code = error.code ?? "";
  if (/^(SV|AC|AF|PR|EV|CO|CE|CM|CA)\d{3}$/.test(code) && error.message) return error.message;
  if (code === "42501") return "No tenés permiso para hacer esto";
  return "No se pudo hacer. Probá de nuevo en un rato.";
}

export async function svcRpc<T>(client: unknown, fn: string, args: Record<string, unknown>): Promise<SvcResult<T>> {
  const { data, error } = await svcSchema(client).rpc(fn, args);
  if (error) {
    return { ok: false, error: { code: error.code ?? null, message: svcErrorMessage(error), detail: (error as { details?: string }).details ?? null } };
  }
  return { ok: true, data: data as T };
}
