/**
 * Supabase Vault — acceso a secrets desde el servidor.
 *
 * Envoltorio de las RPCs de la migracion 00017. Los secrets viven encriptados
 * (AES-256) en Vault y estan namespaceados por workspace: la RPC arma el nombre
 * real, asi que aca solo se pasa el nombre "limpio" (ej: "zernio_api_key").
 *
 * Reglas:
 * - Solo desde el servidor. Nunca importar esto en un Client Component.
 * - El valor del secret nunca se loguea ni se mete en un mensaje de error:
 *   los errores que devuelven estas funciones son seguros para mostrar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Nombres de secret que usa el sistema. Centralizados para no tipear strings sueltos. */
export const SECRET_NAMES = {
  zernioApiKey: "zernio_api_key",
  evolutionApiKey: "evolution_api_key",
  resendApiKey: "resend_api_key",
  openaiApiKey: "openai_api_key",
  anthropicApiKey: "anthropic_api_key",
  googleAiApiKey: "google_ai_api_key",
} as const;

export type SecretName = (typeof SECRET_NAMES)[keyof typeof SECRET_NAMES] | (string & {});

/** Mensaje de la RPC cuando el usuario no es owner/admin del workspace. */
export function isForbiddenSecretError(message: string): boolean {
  return message.includes("forbidden") || message.includes("permission denied");
}

/**
 * Guarda (o rota) un secret. Devuelve `{ ok: true }` o el error de la base.
 * El valor no aparece en el resultado ni en los logs.
 */
export async function storeSecret(
  supabase: SupabaseClient,
  workspaceId: string,
  name: SecretName,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "El valor no puede estar vacio" };

  const { error } = await supabase.rpc("store_secret", {
    secret_name: name,
    secret_value: trimmed,
    workspace_id: workspaceId,
  });

  if (error) {
    console.error(`[vault] store_secret "${name}" failed:`, error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Lee un secret. Devuelve null si no existe.
 * Lanza si el usuario no tiene permiso, porque un null silencioso ahi se
 * confunde con "no configurado" y manda a reconfigurar algo que ya estaba.
 */
export async function readSecret(
  supabase: SupabaseClient,
  workspaceId: string,
  name: SecretName,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("read_secret", {
    secret_name: name,
    workspace_id: workspaceId,
  });

  if (error) {
    console.error(`[vault] read_secret "${name}" failed:`, error.message);
    throw new Error(`No se pudo leer el secret "${name}": ${error.message}`);
  }
  return (data as string | null) ?? null;
}

/** Borra un secret. `false` significa que no existia (no es un error). */
export async function deleteSecret(
  supabase: SupabaseClient,
  workspaceId: string,
  name: SecretName,
): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("delete_secret", {
    secret_name: name,
    workspace_id: workspaceId,
  });

  if (error) {
    console.error(`[vault] delete_secret "${name}" failed:`, error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, deleted: data === true };
}

/** Que secrets tiene configurados el workspace, sin exponer los valores. */
export async function listSecretNames(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("list_secret_names", {
    workspace_id: workspaceId,
  });

  if (error) {
    console.error("[vault] list_secret_names failed:", error.message);
    return [];
  }
  return (data as string[] | null) ?? [];
}
