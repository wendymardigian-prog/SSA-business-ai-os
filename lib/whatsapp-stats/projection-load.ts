/**
 * Lee de la base lo que va a salir por un numero de WhatsApp en los proximos dias y lo arma con
 * `lib/whatsapp-stats/projection.ts`. Solo servidor: el cliente de servicio, DESPUES de que quien llama chequeo
 * `channels.manage` y que el canal es del workspace de la sesion. Nunca lanza: si algo no se puede leer, esa parte
 * queda en 0.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { startOfDay } from "@/lib/dates";
import { DEFAULT_WHATSAPP_POLICY, combinePolicies, parseBroadcastPace, parsePolicy } from "@/lib/send-queue/pace";
import { nextOccurrence, SCHEDULED_TRIGGER_TYPE } from "@/lib/scheduled-flows/schedule";
import { bucketTimes, combineProjection, projectBroadcasts, projectionDays, type Projection, type QueuedBroadcast } from "./projection";

type Db = SupabaseClient<Database>;

const GROUP_SEND_TYPES = new Set(["send_to_group", "send_poll"]);

export async function loadProjection(
  service: Db,
  args: { workspaceId: string; channelId: string; now: Date; viewerTimeZone: string; laneTimeZone: string; broadcastsSentToday: number },
): Promise<Projection> {
  const keys = projectionDays(args.now, args.viewerTimeZone);
  const [ly, lm, ld] = keys[keys.length - 1].split("-").map(Number);
  const horizonEnd = startOfDay(ly, lm, ld + 1, args.viewerTimeZone);
  const opts = { now: args.now, viewerTimeZone: args.viewerTimeZone };

  const [broadcast, sequence, scheduled] = await Promise.all([
    broadcastPart(service, args).catch((err) => fail("broadcasts", err)),
    sequencePart(service, args, horizonEnd, opts).catch((err) => fail("secuencias", err)),
    scheduledPart(service, args, horizonEnd, opts).catch((err) => fail("programadas", err)),
  ]);
  return combineProjection(keys, { broadcast, sequence, scheduled });
}

function fail(part: string, err: unknown): Record<string, number> {
  console.error(`[whatsapp] no pude proyectar ${part}:`, err instanceof Error ? err.message : String(err));
  return {};
}

/** Los broadcasts programados o enviandose por este numero, con sus destinatarios que faltan, por el ritmo del numero. */
async function broadcastPart(
  service: Db,
  args: { workspaceId: string; channelId: string; now: Date; viewerTimeZone: string; laneTimeZone: string; broadcastsSentToday: number },
): Promise<Record<string, number>> {
  const [{ data: channel }, { data: broadcasts }] = await Promise.all([
    service.from("channels").select("send_policy").eq("id", args.channelId).eq("workspace_id", args.workspaceId).maybeSingle(),
    service
      .from("broadcasts")
      .select("id, status, scheduled_for, pace")
      .eq("workspace_id", args.workspaceId)
      .eq("channel_id", args.channelId)
      .in("status", ["scheduled", "sending"]),
  ]);
  if (!broadcasts || broadcasts.length === 0) return {};
  const ceiling = parsePolicy(channel?.send_policy, DEFAULT_WHATSAPP_POLICY);
  const queue: QueuedBroadcast[] = [];
  for (const b of broadcasts.slice(0, 50)) {
    const { count } = await service.from("broadcast_recipients").select("id", { count: "exact", head: true }).eq("broadcast_id", b.id).eq("status", "pending");
    if (!count) continue;
    const scheduledFor = b.scheduled_for ? new Date(b.scheduled_for) : null;
    queue.push({
      start: scheduledFor && scheduledFor > args.now ? scheduledFor : args.now,
      pending: count,
      policy: combinePolicies(ceiling, parseBroadcastPace(b.pace)),
    });
  }
  return projectBroadcasts(queue, { now: args.now, laneTimeZone: args.laneTimeZone, viewerTimeZone: args.viewerTimeZone, sentToday: args.broadcastsSentToday });
}

/** Los pasos de secuencias ya agendados en este numero: un mensaje cada uno. */
async function sequencePart(
  service: Db,
  args: { channelId: string },
  horizonEnd: Date,
  opts: { now: Date; viewerTimeZone: string },
): Promise<Record<string, number>> {
  const { data } = await service
    .from("sequence_enrollments")
    .select("next_step_at")
    .eq("channel_id", args.channelId)
    .eq("status", "active")
    .not("next_step_at", "is", null)
    .lt("next_step_at", horizonEnd.toISOString())
    .limit(5000);
  return bucketTimes((data ?? []).map((r) => r.next_step_at as string), opts);
}

/** Las automatizaciones «En una fecha y hora» publicadas que mandan a grupos de este numero: un mensaje por paso y vez. */
async function scheduledPart(
  service: Db,
  args: { workspaceId: string; channelId: string; laneTimeZone: string },
  horizonEnd: Date,
  opts: { now: Date; viewerTimeZone: string },
): Promise<Record<string, number>> {
  const [{ data: groups }, { data: triggers }] = await Promise.all([
    service.from("whatsapp_groups").select("id").eq("workspace_id", args.workspaceId).eq("channel_id", args.channelId).is("left_at", null),
    service
      .from("triggers")
      .select("config, flows!inner(workspace_id, status, nodes)")
      .eq("type", SCHEDULED_TRIGGER_TYPE as never)
      .eq("is_active", true)
      .eq("flows.workspace_id", args.workspaceId)
      .eq("flows.status", "published"),
  ]);
  const groupIds = new Set((groups ?? []).map((g) => g.id));
  if (groupIds.size === 0 || !triggers) return {};
  const times: Date[] = [];
  for (const row of triggers as unknown as Array<{ config: unknown; flows: { nodes: unknown } | null }>) {
    const nodes = Array.isArray(row.flows?.nodes) ? (row.flows!.nodes as Array<{ type?: string; data?: Record<string, unknown> }>) : [];
    const steps = nodes.filter((n) => {
      const type = n.type === "action" ? String(n.data?.actionType ?? "") : String(n.type ?? "");
      return GROUP_SEND_TYPES.has(type) && typeof n.data?.groupId === "string" && groupIds.has(n.data.groupId as string);
    }).length;
    if (steps === 0) continue;
    let after = opts.now;
    for (let i = 0; i < 60; i++) {
      const next = nextOccurrence(row.config, after, args.laneTimeZone);
      if (!next || next >= horizonEnd) break;
      for (let s = 0; s < steps; s++) times.push(next);
      after = next;
    }
  }
  return bucketTimes(times, opts);
}
