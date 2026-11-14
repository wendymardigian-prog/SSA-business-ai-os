/**
 * Borrar una conexion OAuth del negocio: sus tokens en Vault y su fila (00374).
 *
 * No se revoca el permiso del lado de Google, a proposito: Google revoca TODO
 * lo que esa cuenta le dio al cliente OAuth, no solo lo de esta conexion. Si
 * la misma cuenta de Google tiene YouTube y Drive (o el Calendar de alguien),
 * revocar uno cortaria los otros. Quien quiera quitarlo tambien en Google lo
 * hace desde myaccount.google.com/permissions; la pantalla lo dice.
 *
 * Usa el cliente de servicio: los secretos de OAuth solo los toca el servidor
 * y `oauth_connections` no tiene politicas de escritura para usuarios.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { deleteSecret, oauthSecretName } from "@/lib/vault";

type Db = SupabaseClient<Database>;

export async function removeWorkspaceConnection(
  service: Db,
  workspaceId: string,
  connection: { id: string; vault_secret_prefix: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const kind of ["access_token", "refresh_token"] as const) {
    const removed = await deleteSecret(service, workspaceId, oauthSecretName(connection.vault_secret_prefix, kind));
    if (!removed.ok) return { ok: false, error: removed.error };
  }

  const { error } = await service
    .from("oauth_connections")
    .delete()
    .eq("id", connection.id)
    .eq("workspace_id", workspaceId)
    .is("user_id", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
