import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { listBroadcastChannels } from "@/lib/broadcasts/channels";
import { BroadcastsView, type BroadcastListItem } from "./broadcasts-view";

/**
 * Broadcasts: un mensaje a muchos contactos, por WhatsApp (con ritmo, para no
 * bloquear el número) o por email (docs/broadcasts.md).
 */
export default async function BroadcastsPage() {
  // Equipo y roles (F22): la pagina pide su permiso; desde la 00285 la RLS tambien.
  await requirePermission("broadcasts.manage");
  const { workspace, supabase } = await getWorkspace();

  const [{ data: broadcasts }, channels] = await Promise.all([
    supabase
      .from("broadcasts")
      .select("id, name, status, channel_id, total_recipients, sent, failed, skipped, scheduled_for, created_at, started_at, completed_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(200),
    listBroadcastChannels(supabase, workspace.id),
  ]);

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

  return <BroadcastsView items={items} hasChannels={channels.length > 0} timeZone={workspace.timezone ?? "UTC"} />;
}
