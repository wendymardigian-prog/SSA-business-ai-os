// @plantilla-quitar(ventas)
/**
 * Llamar a las funciones de afiliados (esquema `public`, migracion 00343) desde el servidor. Cada funcion vuelve a
 * mirar el permiso con la sesion del usuario y devuelve errores con codigo propio (AFxxx, CMxxx) y texto listo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type AnyClient = SupabaseClient<any, any, any>;

export interface AffError {
  code: string | null;
  message: string;
}

export type AffResult<T> = { ok: true; data: T } | { ok: false; error: AffError };

export const NOT_ALLOWED: { ok: false; error: AffError } = { ok: false, error: { code: "AF010", message: "No tenés permiso para hacer esto" } };

/** El texto de la base si es nuestro (AF/CM + 3 dígitos); si no, uno genérico. Nunca el error técnico. */
export function affErrorMessage(error: { code?: string | null; message?: string | null } | null | undefined): string {
  if (!error) return "No se pudo hacer";
  const code = error.code ?? "";
  if (/^(AF|CM)\d{3}$/.test(code) && error.message) return error.message;
  if (code === "42501") return "No tenés permiso para hacer esto";
  return "No se pudo hacer. Probá de nuevo en un rato.";
}

export async function affRpc<T>(client: unknown, fn: string, args: Record<string, unknown>): Promise<AffResult<T>> {
  const { data, error } = await (client as AnyClient).rpc(fn, args);
  if (error) {
    console.error(`[afiliados] ${fn} fallo:`, error.code ?? "sin codigo");
    return { ok: false, error: { code: error.code ?? null, message: affErrorMessage(error) } };
  }
  return { ok: true, data: data as T };
}

/** Lo que devuelven `product_links_save` y `affiliate_settings_save`. */
export type SaveStatus<T> =
  | { status: "ok"; rev: number }
  | { status: "conflict"; rev: number; current: T }
  | { status: "invalid"; problems: string[] };
