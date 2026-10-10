/**
 * Supabase Vault — acceso a secrets desde el servidor.
 *
 * Envoltorio de las RPCs de la migracion 00017. Los secrets viven encriptados
 * (AES-256) en Vault y estan namespaceados por workspace: la RPC arma el nombre
 * real, asi que aca solo se pasa el nombre "limpio" (ej: "zernio_api_key").
 *
 * Reglas:
 * - **`readSecret` siempre con el cliente de servicio** (`createServiceClient`).
 *   Desde la 00143, `read_secret` solo la puede ejecutar `service_role`: antes
 *   estaba concedida a `authenticated`, y un Admin podia leer cualquier clave
 *   en texto plano desde la consola del navegador. QUIEN puede usar una clave
 *   lo decide el que llama (el guard de Admin, la RLS de la conversacion), y
 *   el workspace sale siempre de la sesion, nunca del pedido.
 *   `storeSecret`, `deleteSecret` y `listSecretNames` siguen con el cliente
 *   del usuario: ninguna devuelve un valor.
 * - Solo desde el servidor. Nunca importar esto en un Client Component: lo
 *   verifica lib/vault-boundary.test.ts siguiendo los imports.
 * - El valor del secret nunca se loguea ni se mete en un mensaje de error:
 *   los errores que devuelven estas funciones son seguros para mostrar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// Los nombres viven en lib/secret-names.ts, que no importa nada: el catalogo de
// integraciones los necesita y ese catalogo lo lee tambien el navegador. Se
// re-exportan para no romper a quien ya los importaba desde aca.
export { SECRET_NAMES, ALL_SECRET_NAMES, oauthSecretName } from "@/lib/secret-names";
export type { SecretName } from "@/lib/secret-names";

import type { SecretName } from "@/lib/secret-names";

/**
 * El error de Postgres cuando un rol sin EXECUTE llama a `read_secret` (desde
 * la 00143, cualquiera que no sea `service_role`).
 */
export function isReadWithUserSession(message: string): boolean {
  return message.includes("permission denied for function read_secret");
}

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
 * Lee un secret. Devuelve null si no existe. `supabase` tiene que ser el
 * cliente de servicio (ver la cabecera).
 * Lanza si no hay permiso, porque un null silencioso ahi se confunde con "no
 * configurado" y manda a reconfigurar algo que ya estaba.
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
    // "permission denied" es casi siempre un llamador que paso el cliente del
    // usuario: se dice en el log para que no se lea como "no configurado".
    const hint = isReadWithUserSession(error.message)
      ? " (read_secret solo la ejecuta el servidor desde la 00143: pasar createServiceClient())"
      : "";
    console.error(`[vault] read_secret "${name}" failed:`, error.message + hint);
    throw new Error(`No se pudo leer el secret "${name}": ${error.message}${hint}`);
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
