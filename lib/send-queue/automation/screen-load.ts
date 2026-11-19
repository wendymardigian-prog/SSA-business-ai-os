/**
 * Carga de la pantalla «Cola de mensajes». Solo servidor: la llama la página DESPUÉS de comprobar `channels.manage`, con
 * el cliente de servicio y SIEMPRE filtrando por el workspace de la sesión.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SendQueueStatus } from "@/lib/types/database";
import { startOfZonedDay } from "@/lib/dates";
import { isValidTimeZone } from "@/lib/timezone";
import { formatInTz } from "@/lib/scheduling/time/tz";
import { isInWindow, nextWindowOpen } from "@/lib/send-queue/pace";
import { parseContactCap } from "./contact-cap";
import { parseLaneAlert } from "./lane-alert";
import { effectiveQueuePolicy, parseQueuePolicy, warmupLabel, warmupStepsOf } from "./policy";
import { laneCard, type LaneCard, type QueueRow, type QueueScreen } from "./screen";
import { STATUS_TABS, type StatusTabKey } from "./labels";

type Db = SupabaseClient<Database>;

export type { QueueRow, QueueScreen } from "./screen";

const ROW_LIMIT = 200;

export async function loadQueueScreen(
  service: Db,
  workspaceId: string,
  opts: { tab: StatusTabKey; channelId: string | null; viewerTimeZone: string; now?: Date },
): Promise<QueueScreen> {
  const now = opts.now ?? new Date();
  const [{ data: ws }, { data: channelsData }] = await Promise.all([
    service.from("workspaces").select("timezone, send_contact_caps, send_lane_alert").eq("id", workspaceId).maybeSingle(),
    service
      .from("channels")
      .select("id, display_name, username, connection_status, created_at, send_policy")
      .eq("workspace_id", workspaceId)
      .eq("platform", "whatsapp")
      .eq("provider", "evolution")
      .eq("is_active", true)
      .order("created_at"),
  ]);
  const tz = ws?.timezone && isValidTimeZone(ws.timezone) ? ws.timezone : "UTC";
  const channels = channelsData ?? [];
  const nameOf = (c: (typeof channels)[number]) => c.display_name?.trim() || c.username?.trim() || "WhatsApp";
  const ids = channels.map((c) => c.id);
  // Un número que ya no es de este negocio no se filtra (la URL puede traer cualquier cosa).
  const channelFilter = opts.channelId && ids.includes(opts.channelId) ? opts.channelId : null;

  const { data: lanes } = ids.length
    ? await service.from("channel_send_lanes").select("channel_id, next_send_at, paused_at, paused_reason, bulk_paused_at").in("channel_id", ids)
    : { data: [] as Array<{ channel_id: string; next_send_at: string; paused_at: string | null; paused_reason: string | null; bulk_paused_at: string | null }> };
  const laneOf = new Map((lanes ?? []).map((l) => [l.channel_id, l]));

  const dayStart = startOfZonedDay(now, tz).toISOString();
  const sameDay = (a: Date, b: Date) => formatInTz(a, opts.viewerTimeZone, "YYYY-MM-DD") === formatInTz(b, opts.viewerTimeZone, "YYYY-MM-DD");
  const cards: LaneCard[] = await Promise.all(
    channels.map(async (c) => {
      const [{ data: countRows }, { count: pending }] = await Promise.all([
        service.rpc("send_lane_counts", { p_channel_id: c.id, p_day_start: dayStart, p_now: now.toISOString() }),
        service.from("send_queue_items").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("channel_id", c.id).in("status", ["scheduled", "queued"]),
      ]);
      const counts = (countRows ?? [])[0];
      const base = parseQueuePolicy(c.send_policy);
      const since = c.created_at ? new Date(c.created_at) : null;
      const policy = effectiveQueuePolicy(base, since, now);
      const inHours = isInWindow(policy.window, now, tz);
      const opens = inHours ? null : nextWindowOpen(policy.window, now, tz);
      const lane = laneOf.get(c.id);
      return laneCard({
        channelId: c.id,
        name: nameOf(c),
        sessionDown: c.connection_status === "disconnected",
        pausedAt: lane?.paused_at ?? null,
        pausedReason: lane?.paused_reason ?? null,
        bulkPausedAt: lane?.bulk_paused_at ?? null,
        nextSendAt: lane?.next_send_at ?? null,
        policy,
        warmupLabel: warmupLabel(base, since, now),
        warmupSteps: warmupStepsOf(base),
        lastHour: counts?.last_hour ?? 0,
        today: counts?.today ?? 0,
        pending: pending ?? 0,
        inHours,
        opensAtLabel: opens
          ? sameDay(opens, now)
            ? `a las ${formatInTz(opens, opts.viewerTimeZone, "HH:mm")}`
            : `el ${formatInTz(opens, opts.viewerTimeZone, "DD/MM")} a las ${formatInTz(opens, opts.viewerTimeZone, "HH:mm")}`
          : null,
      });
    }),
  );
  const totalPending = cards.reduce((n, c) => n + c.pending, 0);

  // Las pestañas, con su número (del número elegido o de todos).
  const tabs = await Promise.all(
    STATUS_TABS.map(async (t) => {
      let q = service.from("send_queue_items").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).in("status", [...t.statuses]);
      if (channelFilter) q = q.eq("channel_id", channelFilter);
      const { count } = await q;
      return { key: t.key, label: t.label, count: count ?? 0 };
    }),
  );

  // Las filas de la pestaña elegida.
  const tab = STATUS_TABS.find((t) => t.key === opts.tab) ?? STATUS_TABS[0];
  let rowsQ = service
    .from("send_queue_items")
    .select("id, channel_id, status, reason_code, reason, priority, preview, client_label, target_kind, scheduled_for, expires_at, sent_at, attempts, flow_id, updated_at")
    .eq("workspace_id", workspaceId)
    .in("status", [...tab.statuses]);
  if (channelFilter) rowsQ = rowsQ.eq("channel_id", channelFilter);
  rowsQ = tab.key === "pendientes" || tab.key === "enviando" ? rowsQ.order("scheduled_for", { ascending: true }) : rowsQ.order("updated_at", { ascending: false });
  const { data: rowsData } = await rowsQ.limit(ROW_LIMIT + 1);
  const rawRows = rowsData ?? [];
  const flowIds = [...new Set(rawRows.map((r) => r.flow_id).filter((v): v is string => !!v))];
  const { data: flows } = flowIds.length
    ? await service.from("flows").select("id, name").eq("workspace_id", workspaceId).in("id", flowIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const flowName = new Map((flows ?? []).map((f) => [f.id, f.name]));
  const channelName = new Map(channels.map((c) => [c.id, nameOf(c)]));
  const rows: QueueRow[] = rawRows.slice(0, ROW_LIMIT).map((r) => ({
    id: r.id,
    channelId: r.channel_id,
    channelName: channelName.get(r.channel_id) ?? "WhatsApp",
    status: r.status,
    reasonCode: r.reason_code,
    reason: r.reason,
    priority: r.priority,
    preview: r.preview,
    clientLabel: r.client_label,
    targetKind: r.target_kind,
    scheduledFor: r.scheduled_for,
    expiresAt: r.expires_at,
    sentAt: r.sent_at,
    attempts: r.attempts,
    flowId: r.flow_id,
    flowName: r.flow_id ? (flowName.get(r.flow_id) ?? null) : null,
  }));

  // El resumen de hoy (en el día del negocio): lo que terminó hoy.
  const todayCount = async (status: SendQueueStatus, col: "sent_at" | "updated_at") => {
    let q = service.from("send_queue_items").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", status).gte(col, dayStart);
    if (channelFilter) q = q.eq("channel_id", channelFilter);
    return (await q).count ?? 0;
  };
  const [sent, failed, expired, overdue, discarded] = await Promise.all([
    todayCount("sent", "sent_at"),
    todayCount("failed", "updated_at"),
    todayCount("expired", "updated_at"),
    todayCount("overdue", "updated_at"),
    todayCount("discarded", "updated_at"),
  ]);

  return {
    nowMs: now.getTime(),
    cards,
    tabs,
    rows,
    truncated: rawRows.length > ROW_LIMIT,
    totalPending,
    today: { sent, failed, expired, overdue, discarded },
    channels: channels.map((c) => ({ id: c.id, name: nameOf(c) })),
    contactCap: parseContactCap(ws?.send_contact_caps ?? null),
    laneAlert: parseLaneAlert(ws?.send_lane_alert ?? null),
  };
}
