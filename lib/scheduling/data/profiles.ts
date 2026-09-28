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

/** Los usuarios ya tomados por OTRAS personas (para validar el propio). */
export async function takenUsernames(supabase: Db, workspaceId: string, exceptUserId: string): Promise<string[]> {
  const { data } = await supabase
    .from("scheduling_profiles")
    .select("username, user_id")
    .eq("workspace_id", workspaceId);
  return (data ?? []).filter((p) => p.user_id !== exceptUserId).map((p) => p.username);
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
