/**
 * El despachador de la cola de WhatsApp de las automatizaciones. Lo llama el mismo cron que los broadcasts
 * (`/api/cron/send-queue`, cada 15 s), ANTES que ellos: así lo urgente y lo normal de las automatizaciones toman el turno
 * del número primero y los broadcasts (masivo) esperan.
 *
 * Por cada número con algo listo:
 *   1. Lee su ritmo (el del número, con su calentamiento) y lo que ya salió por él (TODO: `send_lane_counts`, 00420).
 *   2. Decide qué prioridades pueden salir (`allowedPriorities`: horario del número, tope del día, de la hora con la
 *      reserva del 20 % para lo urgente y del minuto). Lo urgente con la reserva también gastada caduca con su motivo.
 *   3. Toma el turno del carril con la espera al azar (`claim_lane_slot_at`: gana uno solo) y el próximo envío por
 *      prioridad (`claim_send_queue_item`, SKIP LOCKED). Uno por número y por tic: la espera mínima es más larga que el tic.
 *   4. Lo entrega (`deliverQueueItem`) y deja su estado y su motivo. Transporte: reintenta a 1, 5 y 15 minutos.
 *      Rechazo: fallido sin reintento. Fallos seguidos pausan el número con la pausa y el aviso de siempre (`pauseLane`).
 *   5. Lleva el reloj de «pendientes sin entregar»: si pasa del tope (30 min por defecto), pausa el número y avisa.
 *
 * Nunca lanza por un proveedor. El reloj (`now`) se inyecta: así se prueba el horario y la caducidad sin esperar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SendQueuePriority } from "@/lib/types/database";
import { isValidTimeZone } from "@/lib/timezone";
import { startOfZonedDay } from "@/lib/dates";
import { isInWindow, pickGapSeconds, type LaneCounts } from "@/lib/send-queue/pace";
import { pauseLane } from "@/lib/send-queue/lane-pause";
import { effectiveQueuePolicy, parseQueuePolicy } from "./policy";
import { allowedPriorities } from "./quota";
import { isLaneStalled, nextUndeliveredSince, parseLaneAlert, stalledReason, type LaneAlertSettings, type LaneWaitState } from "./lane-alert";
import { parseContactCap } from "./contact-cap";
import { deliverQueueItem, type QueueItem } from "./deliver";
import { emptySummary, settleQueueItem, type QueueSummary } from "./settle";

export type { QueueSummary } from "./settle";

type Db = SupabaseClient<Database>;

/** Un envío en `sending` hace más que esto: el proceso murió a mitad del envío. Fallido, sin reintento. */
export const QUEUE_STALE_SENDING_MS = 5 * 60_000;
/** Cuánto trabaja un tic como mucho (la llamada de pg_net corta a los 60 s y después corren los broadcasts). */
const TICK_BUDGET_MS = 20_000;

export async function runAutomationQueue(service: Db, now: Date = new Date(), rand: () => number = Math.random): Promise<QueueSummary> {
  const started = Date.now();
  const summary = emptySummary();
  const at = now.toISOString();

  summary.reaped = await reapStaleQueueSending(service, now);
  const { data: expired } = await service.rpc("expire_send_queue_items", { p_now: at });
  summary.expired = Number(expired ?? 0);
  const { data: released } = await service.rpc("release_scheduled_send_queue_items", { p_now: at });
  summary.released = Number(released ?? 0);

  const { data: due, error } = await service
    .from("send_queue_items")
    .select("channel_id, workspace_id")
    .eq("status", "queued")
    .lte("scheduled_for", at)
    .order("scheduled_for")
    .limit(1000);
  if (error) {
    console.error("[send-queue] no pude leer la cola de WhatsApp:", error.message);
    return summary;
  }
  const lanes = new Map<string, string>();
  for (const row of due ?? []) if (!lanes.has(row.channel_id)) lanes.set(row.channel_id, row.workspace_id);

  for (const [channelId, workspaceId] of lanes) {
    if (Date.now() - started > TICK_BUDGET_MS) break;
    summary.lanes += 1;
    try {
      await runQueueLane(service, channelId, workspaceId, now, summary, rand);
    } catch (e) {
      // Un número que se rompe no frena a los demás.
      console.error("[send-queue] carril de la cola fallido:", e instanceof Error ? e.message : "error");
    }
  }
  // Un número sin nada pendiente no está «sin entregar»: su reloj vuelve a cero.
  const busy = [...lanes.keys()];
  let reset = service.from("channel_send_lanes").update({ undelivered_since: null }).not("undelivered_since", "is", null);
  if (busy.length > 0) reset = reset.not("channel_id", "in", `(${busy.join(",")})`);
  const { error: resetError } = await reset;
  if (resetError) console.error("[send-queue] no pude poner a cero el reloj de los números sin pendientes:", resetError.message);
  return summary;
}

/** Los que quedaron `sending` de un proceso que murió: fallidos, sin reintento (mandar dos veces es peor que no mandar). */
async function reapStaleQueueSending(service: Db, now: Date): Promise<number> {
  const { data } = await service
    .from("send_queue_items")
    .update({
      status: "failed",
      reason_code: "stale",
      reason: "El envío se interrumpió a mitad de camino. No se reintenta para no mandar el mensaje dos veces.",
      updated_at: now.toISOString(),
    })
    .eq("status", "sending")
    .lt("claimed_at", new Date(now.getTime() - QUEUE_STALE_SENDING_MS).toISOString())
    .select("id");
  return data?.length ?? 0;
}

type LaneState = { consecutive_failures: number; bulk_paused_at: string | null; undelivered_since: string | null };

async function runQueueLane(service: Db, channelId: string, workspaceId: string, now: Date, summary: QueueSummary, rand: () => number): Promise<void> {
  const at = now.toISOString();
  const { data: lane } = await service.from("channel_send_lanes").select("*").eq("channel_id", channelId).maybeSingle();
  if (!lane) {
    // Primera vez: el carril nace listo para este mismo tic.
    await service.from("channel_send_lanes").upsert({ channel_id: channelId, workspace_id: workspaceId, next_send_at: at }, { onConflict: "channel_id", ignoreDuplicates: true });
    return runQueueLaneWith(service, channelId, workspaceId, now, summary, rand, { consecutive_failures: 0, bulk_paused_at: null, undelivered_since: null });
  }
  if (lane.paused_at || new Date(lane.next_send_at).getTime() > now.getTime()) return;
  return runQueueLaneWith(service, channelId, workspaceId, now, summary, rand, lane);
}

async function runQueueLaneWith(service: Db, channelId: string, workspaceId: string, now: Date, summary: QueueSummary, rand: () => number, lane: LaneState): Promise<void> {
  const at = now.toISOString();
  const [{ data: channel }, { data: ws }] = await Promise.all([
    service
      .from("channels")
      .select("id, created_at, send_policy, provider, platform, evolution_instance, is_active, display_name")
      .eq("id", channelId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    service.from("workspaces").select("timezone, send_contact_caps, send_lane_alert").eq("id", workspaceId).maybeSingle(),
  ]);
  const timeZone = ws?.timezone && isValidTimeZone(ws.timezone) ? ws.timezone : "UTC";
  const alertSettings = parseLaneAlert(ws?.send_lane_alert ?? null);
  const ref = { channelId, workspaceId, label: laneLabel(channel?.display_name ?? null) };

  if (!channel || !channel.is_active || channel.provider !== "evolution" || !channel.evolution_instance) {
    // Un número desconectado o borrado: lo que espera sigue esperando (y caduca a su hora). Se vuelve a mirar en 5 min.
    // Si sigue así dentro del horario, a los minutos de la alerta se pausa y se avisa.
    if (channel) {
      const policyDown = parseQueuePolicy(channel.send_policy);
      const open = isInWindow(policyDown.window, now, timeZone);
      await trackLaneDelivery(service, ref, lane, open ? "pending" : "idle", now, alertSettings);
    }
    await deferQueueLane(service, channelId, new Date(now.getTime() + 5 * 60_000));
    return;
  }
  const policy = effectiveQueuePolicy(parseQueuePolicy(channel.send_policy), channel.created_at ? new Date(channel.created_at) : null, now);

  const { data: countRows, error: countError } = await service.rpc("send_lane_counts", {
    p_channel_id: channelId,
    p_day_start: startOfZonedDay(now, timeZone).toISOString(),
    p_now: at,
  });
  if (countError) {
    console.error("[send-queue] no pude contar el cupo del número:", countError.message);
    await deferQueueLane(service, channelId, new Date(now.getTime() + 60_000));
    return;
  }
  const c = (countRows ?? [])[0];
  const counts: LaneCounts = { lastMinute: c?.last_minute ?? 0, lastHour: c?.last_hour ?? 0, today: c?.today ?? 0 };

  const allowed = allowedPriorities(policy, counts, now, timeZone, { bulkPaused: lane.bulk_paused_at !== null });

  // Lo urgente con la reserva también gastada: caduca con su motivo y se reporta (no espera a la hora siguiente).
  if (allowed.blocks.urgent === "hour") {
    const { data: gone } = await service
      .from("send_queue_items")
      .update({ status: "expired", reason_code: "quota_urgent", reason: "Cupo de urgentes de la hora agotado: no salió.", updated_at: at })
      .eq("channel_id", channelId)
      .eq("status", "queued")
      .eq("priority", "urgent")
      .lte("scheduled_for", at)
      .select("id");
    summary.expired += gone?.length ?? 0;
  }
  // Lo que espera por el cupo se ve «Esperando cupo» en la pantalla.
  const waiting = (["normal", "bulk"] as const).filter((p) => allowed.blocks[p] === "hour" || allowed.blocks[p] === "hour_reserved" || allowed.blocks[p] === "day");
  if (waiting.length > 0) {
    await service
      .from("send_queue_items")
      .update({ reason_code: "waiting_quota", reason: "Esperando cupo del número.", updated_at: at })
      .eq("channel_id", channelId)
      .eq("status", "queued")
      .in("priority", waiting)
      .lte("scheduled_for", at)
      .is("reason_code", null);
  }

  if (allowed.priorities.length === 0) {
    // Espera legítima (horario o cupo): el reloj de «sin entregar» vuelve a cero.
    await trackLaneDelivery(service, ref, lane, "idle", now, alertSettings);
    if (allowed.retryAt) await deferQueueLane(service, channelId, allowed.retryAt);
    return;
  }

  const gap = pickGapSeconds(policy, rand());
  const { data: slot } = await service.rpc("claim_lane_slot_at", { p_channel_id: channelId, p_now: at, p_next: new Date(now.getTime() + gap * 1000).toISOString() });
  if (slot !== true) return; // otro despachador tomó el carril

  const { data: claimed } = await service.rpc("claim_send_queue_item", { p_channel_id: channelId, p_now: at, p_priorities: allowed.priorities as SendQueuePriority[] });
  const item = (claimed ?? [])[0] as QueueItem | undefined;
  if (!item) {
    // Nada listo de lo que puede salir (lo que queda espera un reintento o es de otra prioridad): se libera el turno.
    await service.from("channel_send_lanes").update({ next_send_at: at }).eq("channel_id", channelId);
    await trackLaneDelivery(service, ref, lane, "pending", now, alertSettings);
    return;
  }

  const outcome = await deliverQueueItem(service, item, channel.evolution_instance, {
    policy: parseContactCap(ws?.send_contact_caps ?? null),
    dayStart: startOfZonedDay(now, timeZone).toISOString(),
  });
  if (outcome.kind === "discarded") {
    // Un descarte no usó el turno del número: el próximo puede salir ya.
    await service.from("channel_send_lanes").update({ next_send_at: at }).eq("channel_id", channelId);
  }
  const failures = await settleQueueItem(service, item, outcome, now, summary);
  const consecutive = failures === "reset" ? 0 : failures === "add" ? lane.consecutive_failures + 1 : lane.consecutive_failures;
  if (consecutive !== lane.consecutive_failures) {
    await service.from("channel_send_lanes").update({ consecutive_failures: consecutive }).eq("channel_id", channelId);
  }
  if (outcome.kind === "failed" && (outcome.laneFatal || (policy.pauseAfterFailures > 0 && consecutive >= policy.pauseAfterFailures))) {
    await pauseLane(
      service,
      channelId,
      workspaceId,
      outcome.laneFatal ? outcome.message : `Fallaron ${consecutive} envíos seguidos. Último motivo: ${outcome.message}`,
      ref.label,
    );
    return;
  }
  await trackLaneDelivery(service, ref, lane, outcome.kind === "sent" ? "delivered" : "pending", now, alertSettings);
}

const laneLabel = (name: string | null) => (name ? `WhatsApp · ${name}` : "WhatsApp");

/**
 * Lleva el reloj de «pendientes sin entregar» del número y, si pasa del tope, pausa su cola y avisa a Owner y Admin. Un
 * descarte (no contactar, tope por contacto) cuenta como pendiente: el número no entregó nada, pero el siguiente envío lo
 * pone a cero si sale.
 */
async function trackLaneDelivery(
  service: Db,
  ref: { channelId: string; workspaceId: string; label: string },
  lane: { undelivered_since?: string | null },
  state: LaneWaitState,
  now: Date,
  settings: LaneAlertSettings,
): Promise<void> {
  const current = lane.undelivered_since ?? null;
  const next = nextUndeliveredSince(current, state, now);
  if (next !== current) {
    await service.from("channel_send_lanes").update({ undelivered_since: next }).eq("channel_id", ref.channelId);
  }
  if (isLaneStalled(next, now, settings)) {
    await pauseLane(service, ref.channelId, ref.workspaceId, stalledReason(settings), ref.label);
  }
}

/** Corre la próxima mirada del carril (nunca para atrás). */
async function deferQueueLane(service: Db, channelId: string, at: Date): Promise<void> {
  await service.from("channel_send_lanes").update({ next_send_at: at.toISOString() }).eq("channel_id", channelId).lt("next_send_at", at.toISOString());
}
