import { getWorkspace } from "@/lib/workspace";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { parseDashboardFilters } from "@/lib/dashboards/url-state";
import { loadChatDashboard } from "@/lib/dashboards/load";
import { ChatDashboard } from "@/components/dashboards/chat-dashboard";
import { isAdminRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Dashboard de Chat (Bloque 3, F16-F18). Las métricas se calculan con funciones
 * SQL SECURITY INVOKER: la RLS aplica el scope de leads, así que un Member ve
 * solo sus conversaciones sin lógica extra acá.
 */
export default async function ChatDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, role, supabase } = await getWorkspace();
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") params.set(k, v);

  const filters = parseDashboardFilters(params);
  const timezone = (workspace as { timezone?: string }).timezone ?? "America/Costa_Rica";
  const isAdmin = isAdminRole(role);

  const [data, members, channelsRes] = await Promise.all([
    loadChatDashboard(supabase, { workspaceId: workspace.id, filters, timezone }),
    isAdmin ? getWorkspaceMembers(workspace.id) : Promise.resolve([]),
    supabase.from("channels").select("id, platform, display_name, is_active").eq("workspace_id", workspace.id),
  ]);

  const channels = ((channelsRes.data as Array<{ id: string; platform: string; display_name: string | null; is_active: boolean }> | null) ?? [])
    .map((c) => ({ id: c.id, label: c.display_name ?? c.platform, platform: c.platform, connected: c.is_active }));

  return (
    <ChatDashboard
      data={data}
      filters={filters}
      channels={channels}
      members={members.map((m) => ({ id: m.userId, label: m.name, role: m.role }))}
      isAdmin={isAdmin}
      timezone={timezone}
    />
  );
}
