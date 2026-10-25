/**
 * Lectura del perfil de agenda (B1). Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export type SchedulingProfileRow = Database["public"]["Tables"]["scheduling_profiles"]["Row"];

export async function getProfileForUser(supabase: Db, workspaceId: string, userId: string): Promise<SchedulingProfileRow | null> {
  const { data } = await supabase
    .from("scheduling_profiles")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Los usuarios ya tomados por OTROS perfiles (para validar el propio), en TODA
 * la instalacion: el link publico es /calendario/<usuario>/<evento>, sin el
 * negocio, asi que un usuario no se puede repetir entre dos workspaces
 * (indice `uq_scheduling_profiles_username_global`, 00266). Una misma persona
 * en dos negocios tiene un perfil en cada uno y necesita un usuario distinto
 * en cada uno.
 *
 * `service` es el cliente de servicio: la RLS solo deja ver los perfiles del
 * propio workspace. Quien llama ya chequeo el permiso; solo salen usuarios,
 * que de todos modos son publicos (van en los links).
 */
export async function takenUsernames(service: Db, workspaceId: string, exceptUserId: string): Promise<string[]> {
  const { data, error } = await service
    .from("scheduling_profiles")
    .select("username, user_id, workspace_id");
  if (error) throw new Error(`No pude leer los usuarios de agenda: ${error.message}`);
  return (data ?? [])
    .filter((p) => !(p.workspace_id === workspaceId && p.user_id === exceptUserId))
    .map((p) => p.username);
}

/** Miembros del workspace con su nombre, para el selector de persona. */
export async function listMembersWithProfiles(supabase: Db, workspaceId: string) {
  const [{ data: members }, { data: profiles }] = await Promise.all([
    supabase.from("workspace_members").select("user_id, role").eq("workspace_id", workspaceId),
    supabase.from("scheduling_profiles").select("user_id, username, display_name, avatar_url, timezone, is_active").eq("workspace_id", workspaceId),
  ]);
  const byUser = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  return (members ?? []).map((m) => ({
    userId: m.user_id,
    role: m.role,
    profile: byUser.get(m.user_id) ?? null,
  }));
}
