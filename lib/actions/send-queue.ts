"use server";

/**
 * Acciones de la cola de WhatsApp (00420). En un archivo `"use server"` todo lo exportado es una función asincrónica.
 *
 * Pausar, reanudar y vaciar un número, pausar lo masivo, el calentamiento, el tope por contacto y la alerta piden
 * `channels.manage` (configurar canales). Escriben con el cliente de servicio DESPUÉS del permiso, filtrando por el
 * workspace de la sesión, y quedan en el historial (`audit_log`).
 *
 * «Aplicar a los envíos programados» pide `flows.edit`: recalcula, desde el momento guardado, la fecha de los envíos
 * programados de UNA automatización con la versión publicada de cada paso. Lo que con la regla nueva ya habría tenido
 * que salir queda vencido (no sale de golpe). El texto ya congelado no cambia.
 */
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { applyScheduleCore } from "@/lib/send-queue/automation/apply-schedule";
import { warmupStepsInput } from "@/lib/send-queue/automation/policy";
import { contactCapInput } from "@/lib/send-queue/automation/contact-cap";
import { laneAlertInput } from "@/lib/send-queue/automation/lane-alert";
import type { Json } from "@/lib/types/database";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const QUEUE_PATH = "/dashboard/flows/cola";
const NO_PERMISSION = "No tenés permiso para manejar la cola de los números.";

async function laneContext(channelId: string) {
  if (!isUuid(channelId)) return { error: "Número no válido." } as const;
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return { error: NO_PERMISSION } as const;
  const service = await createServiceClient();
  const { data: channel } = await service
    .from("channels")
    .select("id, send_policy, platform, provider")
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!channel || channel.platform !== "whatsapp" || channel.provider !== "evolution") return { error: "Ese número no existe." } as const;
  return { ctx, service, channel } as const;
}

async function ensureLane(service: Awaited<ReturnType<typeof createServiceClient>>, channelId: string, workspaceId: string) {
  await service.from("channel_send_lanes").upsert({ channel_id: channelId, workspace_id: workspaceId }, { onConflict: "channel_id", ignoreDuplicates: true });
}

/** Pausar un número: no sale nada de su cola (ni de sus broadcasts) hasta reanudarlo. Lo programado no se pierde. */
export async function pauseQueueLane(channelId: string): Promise<Result> {
  const c = await laneContext(channelId);
  if ("error" in c) return { ok: false, error: c.error ?? "No se pudo." };
  await ensureLane(c.service, channelId, c.ctx.workspace.id);
  const { error } = await c.service
    .from("channel_send_lanes")
    .update({ paused_at: new Date().toISOString(), paused_reason: "Pausado a mano desde la cola de mensajes." })
    .eq("channel_id", channelId)
    .eq("workspace_id", c.ctx.workspace.id);
  if (error) return { ok: false, error: "No pude pausar el número. Probá de nuevo." };
  await logAudit({ supabase: c.service, workspaceId: c.ctx.workspace.id, entityType: "channel", entityId: channelId, action: "send_queue.paused", performedBy: c.ctx.user.id });
  revalidatePath(QUEUE_PATH);
  return { ok: true };
}

/** Reanudar un número pausado (a mano, por fallos seguidos o porque dejó de entregar). Los contadores vuelven a cero. */
export async function resumeQueueLane(channelId: string): Promise<Result> {
  const c = await laneContext(channelId);
  if ("error" in c) return { ok: false, error: c.error ?? "No se pudo." };
  const { error } = await c.service
    .from("channel_send_lanes")
    .update({ paused_at: null, paused_reason: null, consecutive_failures: 0, undelivered_since: null, next_send_at: new Date().toISOString() })
    .eq("channel_id", channelId)
    .eq("workspace_id", c.ctx.workspace.id);
  if (error) return { ok: false, error: "No pude reanudar el número. Probá de nuevo." };
  await logAudit({ supabase: c.service, workspaceId: c.ctx.workspace.id, entityType: "channel", entityId: channelId, action: "send_queue.resumed", performedBy: c.ctx.user.id });
  revalidatePath(QUEUE_PATH);
  return { ok: true };
}

/** Pausar o reanudar lo masivo del número (broadcasts y lo masivo de la cola). Lo urgente y lo normal siguen saliendo. */
export async function setBulkPaused(channelId: string, paused: boolean): Promise<Result> {
  const c = await laneContext(channelId);
  if ("error" in c) return { ok: false, error: c.error ?? "No se pudo." };
  await ensureLane(c.service, channelId, c.ctx.workspace.id);
  const { error } = await c.service
    .from("channel_send_lanes")
    .update({ bulk_paused_at: paused === true ? new Date().toISOString() : null })
    .eq("channel_id", channelId)
    .eq("workspace_id", c.ctx.workspace.id);
  if (error) return { ok: false, error: "No pude cambiar lo masivo del número. Probá de nuevo." };
  await logAudit({
    supabase: c.service,
    workspaceId: c.ctx.workspace.id,
    entityType: "channel",
    entityId: channelId,
    action: paused === true ? "send_queue.bulk_paused" : "send_queue.bulk_resumed",
    performedBy: c.ctx.user.id,
  });
  revalidatePath(QUEUE_PATH);
  return { ok: true };
}

/** Vaciar la cola de un número: lo programado y lo que espera turno queda descartado con el motivo. */
export async function emptyQueueLane(channelId: string): Promise<Result<{ count: number }>> {
  const c = await laneContext(channelId);
  if ("error" in c) return { ok: false, error: c.error ?? "No se pudo." };
  const { data, error } = await c.service.rpc("empty_send_queue", {
    p_workspace_id: c.ctx.workspace.id,
    p_channel_id: channelId,
    p_reason: "Se vació la cola del número a mano.",
  });
  if (error) return { ok: false, error: "No pude vaciar la cola. Probá de nuevo." };
  const count = Number(data ?? 0);
  await logAudit({
    supabase: c.service,
    workspaceId: c.ctx.workspace.id,
    entityType: "channel",
    entityId: channelId,
    action: "send_queue.emptied",
    metadata: { count },
    performedBy: c.ctx.user.id,
  });
  revalidatePath(QUEUE_PATH);
  return { ok: true, count };
}

/**
 * El calentamiento del número: la escalera de tramos («N días al X %») y, si `restart`, volver a calentar desde hoy (por
 * ejemplo, después de una restricción de WhatsApp). Mezcla en `send_policy` sin pisar el ritmo.
 */
export async function saveWarmup(channelId: string, input: { steps: unknown; restart: boolean }): Promise<Result> {
  const c = await laneContext(channelId);
  if ("error" in c) return { ok: false, error: c.error ?? "No se pudo." };
  const parsed = warmupStepsInput(input?.steps);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const prev = c.channel.send_policy && typeof c.channel.send_policy === "object" && !Array.isArray(c.channel.send_policy) ? (c.channel.send_policy as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...prev, warmupSteps: parsed.value };
  if (input?.restart === true) next.warmupFrom = new Date().toISOString();
  const { error } = await c.service
    .from("channels")
    .update({ send_policy: next as unknown as Json })
    .eq("id", channelId)
    .eq("workspace_id", c.ctx.workspace.id);
  if (error) return { ok: false, error: "No pude guardar el calentamiento. Probá de nuevo." };
  await logAudit({
    supabase: c.service,
    workspaceId: c.ctx.workspace.id,
    entityType: "channel",
    entityId: channelId,
    action: "send_queue.warmup",
    metadata: { steps: parsed.value.map((s) => ({ days: s.days, factor: s.factor })), restart: input?.restart === true } as unknown as Record<string, Json>,
    performedBy: c.ctx.user.id,
  });
  revalidatePath(QUEUE_PATH);
  return { ok: true };
}

async function workspaceContext() {
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return null;
  return { ctx, service: await createServiceClient() };
}

/** El tope de WhatsApp automáticos por contacto y día (apagado por defecto). */
export async function saveContactCap(input: unknown): Promise<Result> {
  const w = await workspaceContext();
  if (!w) return { ok: false, error: NO_PERMISSION };
  const parsed = contactCapInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { error } = await w.service.from("workspaces").update({ send_contact_caps: parsed.value as unknown as Json }).eq("id", w.ctx.workspace.id);
  if (error) return { ok: false, error: "No pude guardar el tope. Probá de nuevo." };
  await logAudit({
    supabase: w.service,
    workspaceId: w.ctx.workspace.id,
    entityType: "workspace",
    entityId: w.ctx.workspace.id,
    action: "send_queue.settings",
    metadata: { contactCap: parsed.value as unknown as Json },
    performedBy: w.ctx.user.id,
  });
  revalidatePath(QUEUE_PATH);
  return { ok: true };
}

/** Los minutos con pendientes sin entregar antes de pausar el número y avisar. */
export async function saveLaneAlert(minutes: unknown): Promise<Result> {
  const w = await workspaceContext();
  if (!w) return { ok: false, error: NO_PERMISSION };
  const parsed = laneAlertInput(minutes);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { error } = await w.service.from("workspaces").update({ send_lane_alert: parsed.value as unknown as Json }).eq("id", w.ctx.workspace.id);
  if (error) return { ok: false, error: "No pude guardar la alerta. Probá de nuevo." };
  await logAudit({
    supabase: w.service,
    workspaceId: w.ctx.workspace.id,
    entityType: "workspace",
    entityId: w.ctx.workspace.id,
    action: "send_queue.settings",
    metadata: { laneAlert: parsed.value as unknown as Json },
    performedBy: w.ctx.user.id,
  });
  revalidatePath(QUEUE_PATH);
  return { ok: true };
}

/** «Aplicar a los envíos programados» de una automatización (con la versión publicada). */
export async function applyScheduleToQueued(flowId: string): Promise<Result<{ updated: number; overdue: number; unchanged: number }>> {
  if (!isUuid(flowId)) return { ok: false, error: "Automatización no válida." };
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: "No tenés permiso para editar automatizaciones." };
  const service = await createServiceClient();
  const res = await applyScheduleCore(service, ctx.workspace.id, flowId);
  if (!res.ok) return res;
  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "flow",
    entityId: flowId,
    action: "send_queue.schedule_applied",
    metadata: { updated: res.updated, overdue: res.overdue, unchanged: res.unchanged },
    performedBy: ctx.user.id,
  });
  revalidatePath(QUEUE_PATH);
  return { ok: true, updated: res.updated, overdue: res.overdue, unchanged: res.unchanged };
}
