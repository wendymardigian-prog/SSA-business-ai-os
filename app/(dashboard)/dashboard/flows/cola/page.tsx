import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { loadQueueScreen } from "@/lib/send-queue/automation/screen-load";
import { parseStatusTab } from "@/lib/send-queue/automation/labels";
import { QueueView } from "@/components/send-queue/queue-view";

export const dynamic = "force-dynamic";

/**
 * «Cola de mensajes» (cola de WhatsApp, 00420): una tarjeta por número y los envíos de las automatizaciones por estado.
 * Pide `channels.manage` (pausar, vaciar y ajustar un número es configuración del canal). Lee con el cliente de servicio
 * DESPUÉS del permiso, siempre filtrando por el workspace de la sesión.
 */
export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("channels.manage");
  const { workspace } = await getWorkspace();
  const sp = await searchParams;
  const tab = parseStatusTab(typeof sp.estado === "string" ? sp.estado : undefined);
  const channelId = typeof sp.numero === "string" && /^[0-9a-f-]{36}$/i.test(sp.numero) ? sp.numero : null;
  const viewerTimeZone = await resolveViewerTimezone(workspace.timezone);
  const screen = await loadQueueScreen(await createServiceClient(), workspace.id, { tab, channelId, viewerTimeZone });
  return <QueueView screen={screen} tab={tab} channelId={channelId} viewerTimeZone={viewerTimeZone} />;
}
