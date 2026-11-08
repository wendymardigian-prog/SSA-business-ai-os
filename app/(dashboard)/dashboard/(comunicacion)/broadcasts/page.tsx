import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { listBroadcastChannels } from "@/lib/broadcasts/channels";
import { parseStatusFilter, STATUS_FILTERS } from "@/lib/broadcasts/list";
import { firstParam } from "@/lib/url-params";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import type { BroadcastStatus } from "@/lib/types/database";
import { BroadcastsView, type BroadcastListItem } from "./broadcasts-view";

/**
 * Broadcasts: un mensaje a muchos contactos, por WhatsApp (con ritmo, para no
 * bloquear el número) o por email (docs/broadcasts.md). `?estado=` filtra por
 * estado en la consulta (así aparecen también los viejos); el orden es siempre
 * por fecha de creación, lo más nuevo arriba.
 */
export default async function BroadcastsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Equipo y roles (F22): la pagina pide su permiso; desde la 00285 la RLS tambien.
  await requirePermission("broadcasts.manage");
  const { workspace, supabase } = await getWorkspace();
  const statusFilter = parseStatusFilter(firstParam((await searchParams).estado));

  let list = supabase
    .from("broadcasts")
    .select("id, name, status, channel_id, total_recipients, sent, failed, skipped, scheduled_for, created_at, started_at, completed_at")
    .eq("workspace_id", workspace.id);
  if (statusFilter) list = list.eq("status", statusFilter);

  const countFor = (status: BroadcastStatus) =>
    supabase.from("broadcasts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", status);

  const [{ data: broadcasts }, channels, countRes] = await Promise.all([
    list.order("created_at", { ascending: false }).limit(200),
    listBroadcastChannels(supabase, workspace.id),
    Promise.all(STATUS_FILTERS.map((f) => countFor(f.status))),
  ]);

  // Si un conteo falla, esa píldora no se muestra (el filtro por URL sigue andando).
  const counts = Object.fromEntries(STATUS_FILTERS.map((f, i) => [f.status, countRes[i].count ?? 0])) as Record<BroadcastStatus, number>;

  const labels = new Map(channels.map((c) => [c.id, c.label]));
  const items: BroadcastListItem[] = (broadcasts ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    status: b.status,
    channelLabel: b.channel_id ? (labels.get(b.channel_id) ?? "Canal desconectado") : null,
    total: b.total_recipients,
    sent: b.sent,
    failed: b.failed,
    skipped: b.skipped,
    scheduledFor: b.scheduled_for,
    createdAt: b.created_at,
  }));

  return (
    <BroadcastsView
      items={items}
      counts={counts}
      statusFilter={statusFilter}
      hasChannels={channels.length > 0}
      timeZone={await resolveViewerTimezone(workspace.timezone)}
    />
  );
}
