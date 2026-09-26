import { getWorkspace } from "@/lib/workspace";
import { countUnreadNotifications } from "@/lib/actions/notifications";
import { countPendingDrafts } from "@/lib/actions/agent-drafts";
import { Sidebar } from "@/components/sidebar";
import { DashboardChromeProvider } from "@/components/dashboard-chrome";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { workspace, user, role, supabase } = await getWorkspace();

  // El conteo se calcula en el servidor para que la campana no arranque en cero
  // y salte a su valor real un instante despues.
  const [{ data: memberships }, unreadNotifications, draftCounts] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("role, workspaces(id, name, slug)")
      .eq("user_id", user.id),
    countUnreadNotifications(),
    countPendingDrafts(),
  ]);

  const workspaces = (memberships ?? [])
    .map((m) => ({
      ...(m.workspaces as { id: string; name: string; slug: string }),
      role: m.role,
    }))
    .filter((w) => w.id);

  // En el telefono el menu lateral se esconde y su lugar lo toma la barra
  // superior de cada pantalla (F7): el boton del menu y la campana viven ahi.
  // El layout ya no dibuja una barra propia, asi que no hay dos.
  //
  // h-dvh y no h-screen: en el telefono la barra del navegador aparece y
  // desaparece, y con h-screen el pie de la pantalla queda tapado.
  return (
    <DashboardChromeProvider
      value={{ workspace, user, workspaces, role, unreadNotifications, draftCounts }}
    >
      <div className="flex h-dvh">
        <Sidebar
          workspace={workspace}
          user={user}
          role={role}
          workspaces={workspaces}
          unreadNotifications={unreadNotifications}
          draftCounts={draftCounts}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </DashboardChromeProvider>
  );
}
