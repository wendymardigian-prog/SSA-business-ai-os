/**
 * Desconectar una cuenta de Fathom (F6): borra los dos tokens de Vault y deja
 * la conexion `revoked`. Las llamadas que ya entraron NO se tocan: son del
 * negocio. Lo usan "Desconectar" y "salir del equipo".
 *
 * La fila se conserva (no se borra): `calls.connection_id` apunta a ella y
 * sirve para saber de donde vino cada llamada.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { deleteSecret, oauthSecretName } from "@/lib/vault";

type Db = SupabaseClient<Database>;

export interface RevokableConnection {
  id: string;
  workspace_id: string;
  vault_secret_prefix: string;
}

export async function revokeFathomConnection(service: Db, connection: RevokableConnection): Promise<{ ok: true } | { ok: false; error: string }> {
  const [access, refresh] = await Promise.all([
    deleteSecret(service, connection.workspace_id, oauthSecretName(connection.vault_secret_prefix, "access_token")),
    deleteSecret(service, connection.workspace_id, oauthSecretName(connection.vault_secret_prefix, "refresh_token")),
  ]);
  if (!access.ok || !refresh.ok) return { ok: false, error: "No pude borrar los tokens guardados" };

  const { error } = await service
    .from("oauth_connections")
    .update({ status: "revoked", last_error: null, sync_cursor: null, sync_last_error: null, token_expires_at: null })
    .eq("id", connection.id);
  if (error) return { ok: false, error: "No pude desconectar la cuenta" };
  return { ok: true };
}

/** Revoca todas las conexiones vivas de una persona en un workspace (salir del equipo). */
export async function revokeFathomConnectionsOf(service: Db, workspaceId: string, userId: string): Promise<number> {
  const { data } = await service
    .from("oauth_connections")
    .select("id, workspace_id, vault_secret_prefix")
    .eq("workspace_id", workspaceId)
    .eq("provider", "fathom")
    .eq("user_id", userId)
    .neq("status", "revoked");
  let revoked = 0;
  for (const c of data ?? []) {
    const r = await revokeFathomConnection(service, c as RevokableConnection);
    if (r.ok) revoked++;
    else console.error("[fathom] no pude revocar una conexión al salir del equipo");
  }
  return revoked;
}
