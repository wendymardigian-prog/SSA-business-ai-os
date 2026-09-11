import { getWorkspace } from "@/lib/workspace";
import { countUnreadNotifications } from "@/lib/actions/notifications";
import { Sidebar } from "@/components/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { workspace, user, role, supabase } = await getWorkspace();

  // El conteo se calcula en el servidor para que la campana no arranque en cero
  // y salte a su valor real un instante despues.
  const [{ data: memberships }, unreadNotifications] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("role, workspaces(id, name, slug)")
      .eq("user_id", user.id),
    countUnreadNotifications(),
  ]);

  const workspaces = (memberships ?? [])
    .map((m) => ({
      ...(m.workspaces as { id: string; name: string; slug: string }),
      role: m.role,
    }))
    .filter((w) => w.id);

  return (
    <div className="flex h-screen">
      <Sidebar
        workspace={workspace}
        user={user}
        role={role}
        workspaces={workspaces}
        unreadNotifications={unreadNotifications}
      />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
