import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { hostCandidates, type HostCandidate } from "@/lib/scheduling/host-change";

/**
 * Las personas a las que se les puede pasar un evento. Con el cliente de servicio
 * (quien llama ya chequeo `scheduling.manage_others`): la RLS le muestra las cuentas
 * de Google de otros solo a Owner y Admin, y un rol con el permiso veria a todos
 * "sin Google Calendar".
 */
export async function loadHostCandidates(service: SupabaseClient<Database>, workspaceId: string): Promise<HostCandidate[]> {
  const [members, { data: profiles }, { data: connections }] = await Promise.all([
    getWorkspaceMembers(workspaceId),
    service.from("scheduling_profiles").select("user_id, username, is_active").eq("workspace_id", workspaceId),
    service.from("oauth_connections").select("user_id").eq("workspace_id", workspaceId).eq("provider", "google_calendar").eq("status", "active"),
  ]);
  return hostCandidates(members, profiles ?? [], (connections ?? []).map((c) => c.user_id).filter((id): id is string => Boolean(id)));
}
