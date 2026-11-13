/**
 * Que conexion OAuth del negocio usar (00374).
 *
 * LinkedIn, Threads y Google Drive tienen una sola conexion por negocio. YouTube
 * puede tener varias, una por canal: quien publica, lee metricas o comentarios
 * tiene que decir DE QUE CANAL, y eso es el `external_account_id` (el id del
 * canal, el mismo que la cuenta social guarda en `external_id` y el publicador
 * en `account_ref`).
 *
 * Sin canal (un llamador viejo, o una cuenta que nunca lo guardo) se usa la
 * conexion mas antigua: es la que existia antes de que hubiera varias, asi que
 * el comportamiento de siempre no cambia.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OAuthProvider } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export interface WorkspaceConnection {
  id: string;
  vault_secret_prefix: string;
  status: string;
  token_expires_at: string | null;
  external_account_id: string | null;
}

export async function findWorkspaceConnection(
  supabase: Db,
  workspaceId: string,
  provider: OAuthProvider,
  externalAccountId?: string | null,
): Promise<WorkspaceConnection | null> {
  let query = supabase
    .from("oauth_connections")
    .select("id, vault_secret_prefix, status, token_expires_at, external_account_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .is("user_id", null);

  if (externalAccountId) query = query.eq("external_account_id", externalAccountId);

  const { data, error } = await query.order("created_at", { ascending: true }).limit(1);
  if (error) {
    console.error(`[oauth] no pude buscar la conexion de ${provider}:`, error.message);
    return null;
  }
  return (data?.[0] as WorkspaceConnection | undefined) ?? null;
}
