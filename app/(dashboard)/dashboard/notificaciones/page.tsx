import { getWorkspace } from "@/lib/workspace";
import { listNotificationsPage } from "@/lib/actions/notifications";
import { parseNotificationPage, parseNotificationView } from "@/lib/notifications/page-view";
import { NotificationsPage } from "@/components/notifications/notifications-page";

/**
 * Notificaciones a pantalla completa. Como la campana, es de cada persona: no pide ningún permiso y muestra lo
 * mismo que ella (lo propio y lo general, sin lo silenciado en Mi cuenta → Notificaciones; la RLS decide el resto).
 */
export default async function NotificacionesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const view = parseNotificationView(params.vista);
  const page = parseNotificationPage(params.pagina);
  const [{ workspace }, data] = await Promise.all([getWorkspace(), listNotificationsPage(view, page)]);
  return <NotificationsPage workspaceId={workspace.id} view={view} page={page} data={data} />;
}
