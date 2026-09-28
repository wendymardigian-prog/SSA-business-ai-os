"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { isValidTimeZone } from "@/lib/timezone";
import type { Json } from "@/lib/types/database";
import {
  parseOverrides,
  parseWeeklyHours,
  trimPastOverrides,
  upsertOverrides,
  validateOverrides,
  validateWeeklyHours,
} from "@/lib/scheduling/availability-schema";
import { copyName, decideDeleteSchedule, decideToggleEventSchedule } from "@/lib/scheduling/schedule-rules";
import { dateInTz } from "@/lib/scheduling/time/tz";
import { getSchedule, listSchedules, listUserEventTypes, toSchedule } from "@/lib/scheduling/data/schedules";
import type { DateOverride } from "@/lib/scheduling/types";

/**
 * Horarios (F10, F11, F12, F14). Todo lo que escribe `weekly_hours` o
 * `date_overrides` pasa por la validacion compartida con el cliente: una
 * entrada invalida no se guarda.
 */

const PATH = "/dashboard/agenda/configuracion/disponibilidad";

export type ScheduleActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string; day?: string };

async function ownerOf(scheduleId: string): Promise<{ ctx: PermissionContext; row: NonNullable<Awaited<ReturnType<typeof getSchedule>>> } | { error: string }> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { error: "No tenes permiso para tener una agenda" };
  const row = await getSchedule(ctx.supabase, scheduleId);
  if (!row || row.workspace_id !== ctx.workspace.id) return { error: "No encontre ese horario" };
  if (row.user_id !== ctx.user.id && !ctx.can("scheduling.manage_others")) return { error: "No tenes permiso para editar horarios de otra persona" };
  return { ctx, row };
}

export async function createSchedule(input: { name: string; timezone: string; forUserId?: string | null }): Promise<ScheduleActionResult<{ id: string }>> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ok: false, error: "No tenes permiso para tener una agenda" };
  const targetId = input.forUserId && input.forUserId !== ctx.user.id ? input.forUserId : ctx.user.id;
  if (targetId !== ctx.user.id && !ctx.can("scheduling.manage_others")) return { ok: false, error: "No tenes permiso para crear horarios de otra persona" };

  const name = (input.name ?? "").trim();
  if (name.length < 1 || name.length > 60) return { ok: false, error: "El nombre tiene que tener entre 1 y 60 caracteres" };
  if (!isValidTimeZone(input.timezone)) return { ok: false, error: "La zona horaria no es valida" };

  const existing = await listSchedules(ctx.supabase, ctx.workspace.id, targetId);
  const { data, error } = await ctx.supabase
    .from("availability_schedules")
    .insert({
      workspace_id: ctx.workspace.id,
      user_id: targetId,
      name,
      timezone: input.timezone,
      // El primero de la persona es el por defecto (F10).
      is_default: existing.length === 0,
      weekly_hours: {},
      date_overrides: [],
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: `No pude crear el horario: ${error?.message ?? ""}` };
  if (existing.length === 0) {
    await ctx.supabase.from("scheduling_profiles").update({ default_schedule_id: data.id }).eq("workspace_id", ctx.workspace.id).eq("user_id", targetId);
  }
  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "availability_schedule", entityId: data.id, action: "schedule.created", performedBy: ctx.user.id });
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

/** Guarda nombre, zona y reglas semanales (F11). Validacion compartida. */
export async function saveScheduleHours(input: { scheduleId: string; name: string; timezone: string; weeklyHours: unknown }): Promise<ScheduleActionResult> {
  const owned = await ownerOf(input.scheduleId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;

  const name = (input.name ?? "").trim();
  if (name.length < 1 || name.length > 60) return { ok: false, error: "El nombre tiene que tener entre 1 y 60 caracteres" };
  if (!isValidTimeZone(input.timezone)) return { ok: false, error: "La zona horaria no es valida" };

  const checked = validateWeeklyHours(input.weeklyHours);
  if (!checked.ok) return { ok: false, error: checked.errors[0]?.message ?? "Los rangos no son validos", day: checked.errors[0]?.day };
  const weekly = parseWeeklyHours(input.weeklyHours);
  if (!weekly) return { ok: false, error: "Los rangos no son validos" };

  const { error } = await ctx.supabase
    .from("availability_schedules")
    .update({ name, timezone: input.timezone, weekly_hours: weekly as unknown as Json })
    .eq("id", row.id);
  if (error) return { ok: false, error: `No pude guardar el horario: ${error.message}` };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "availability_schedule",
    entityId: row.id,
    action: "schedule.updated",
    changes: {
      ...(row.name !== name ? { name: { old: row.name, new: name } } : {}),
      ...(row.timezone !== input.timezone ? { timezone: { old: row.timezone, new: input.timezone } } : {}),
      weekly_hours: { old: row.weekly_hours, new: weekly as unknown as Json },
    },
    performedBy: ctx.user.id,
  });
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Suma o reemplaza excepciones (F12): una entrada por dia, en una sola
 * actualizacion. Al guardar, las de mas de 90 dias atras se recortan y van a
 * audit_log.
 */
export async function saveOverrides(input: { scheduleId: string; overrides: unknown }): Promise<ScheduleActionResult<{ saved: number; trimmed: number }>> {
  const owned = await ownerOf(input.scheduleId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;

  const checked = validateOverrides(input.overrides);
  if (!checked.ok) return { ok: false, error: checked.errors[0]?.message ?? "Las excepciones no son validas", day: checked.errors[0]?.day };
  const incoming = parseOverrides(input.overrides);
  if (!incoming) return { ok: false, error: "Las excepciones no son validas" };
  if (incoming.length === 0) return { ok: false, error: "Elegí al menos un día" };

  const current = toSchedule(row).date_overrides;
  const merged = upsertOverrides(current, incoming);
  const today = dateInTz(new Date(), row.timezone);
  const { kept, removed } = trimPastOverrides(merged, today);

  const { error } = await ctx.supabase
    .from("availability_schedules")
    .update({ date_overrides: kept as unknown as Json })
    .eq("id", row.id);
  if (error) return { ok: false, error: `No pude guardar la excepción: ${error.message}` };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "availability_schedule",
    entityId: row.id,
    action: "schedule.updated",
    changes: { date_overrides: { old: row.date_overrides, new: kept as unknown as Json } },
    metadata: { trimmed_overrides: removed as unknown as Json, added: incoming.map((o) => o.date) },
    performedBy: ctx.user.id,
  });
  revalidatePath(PATH);
  return { ok: true, data: { saved: incoming.length, trimmed: removed.length } };
}

export async function deleteOverride(input: { scheduleId: string; date: string }): Promise<ScheduleActionResult> {
  const owned = await ownerOf(input.scheduleId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;
  const current = toSchedule(row).date_overrides;
  const next: DateOverride[] = current.filter((o) => o.date !== input.date);
  const { error } = await ctx.supabase.from("availability_schedules").update({ date_overrides: next as unknown as Json }).eq("id", row.id);
  if (error) return { ok: false, error: `No pude borrar la excepción: ${error.message}` };
  revalidatePath(PATH);
  return { ok: true };
}

/** Marcar por defecto: la RPC lo hace en una sola transaccion (F10). */
export async function setDefaultSchedule(scheduleId: string): Promise<ScheduleActionResult> {
  const owned = await ownerOf(scheduleId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx } = owned;
  const { error } = await ctx.supabase.rpc("set_default_schedule", { p_schedule_id: scheduleId });
  if (error) return { ok: false, error: `No pude marcarlo por defecto: ${error.message}` };
  revalidatePath(PATH);
  return { ok: true };
}

export async function duplicateSchedule(scheduleId: string): Promise<ScheduleActionResult<{ id: string }>> {
  const owned = await ownerOf(scheduleId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;
  const siblings = await listSchedules(ctx.supabase, ctx.workspace.id, row.user_id);
  const { data, error } = await ctx.supabase
    .from("availability_schedules")
    .insert({
      workspace_id: ctx.workspace.id,
      user_id: row.user_id,
      name: copyName(row.name, siblings.map((s) => s.name)),
      timezone: row.timezone,
      is_default: false,
      weekly_hours: row.weekly_hours,
      date_overrides: row.date_overrides,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: `No pude duplicar el horario: ${error?.message ?? ""}` };
  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "availability_schedule", entityId: data.id, action: "schedule.created", metadata: { duplicated_from: row.id }, performedBy: ctx.user.id });
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

/** Borrar (soft): nunca el por defecto; con eventos, exige el reemplazo y los mueve antes (F10). */
export async function deleteSchedule(input: { scheduleId: string; replacementId?: string | null }): Promise<ScheduleActionResult> {
  const owned = await ownerOf(input.scheduleId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;

  const siblings = await listSchedules(ctx.supabase, ctx.workspace.id, row.user_id);
  const events = await listUserEventTypes(ctx.supabase, ctx.workspace.id, row.user_id);
  const usingIt = events.filter((e) => e.schedule_id === row.id);
  const decision = decideDeleteSchedule({
    schedule: { id: row.id, name: row.name, is_default: row.is_default },
    others: siblings.filter((s) => s.id !== row.id).map((s) => ({ id: s.id, name: s.name, is_default: s.is_default })),
    eventsUsingIt: usingIt.length,
    replacementId: input.replacementId,
  });
  if (!decision.ok) return { ok: false, error: decision.message };

  if (decision.moveEventsTo && usingIt.length > 0) {
    const { error } = await ctx.supabase
      .from("event_types" as never)
      .update({ schedule_id: decision.moveEventsTo } as never)
      .in("id", usingIt.map((e) => e.id));
    if (error) return { ok: false, error: `No pude mover los eventos: ${error.message}` };
  }

  const { error } = await ctx.supabase
    .from("availability_schedules")
    .update({ deleted_at: new Date().toISOString(), is_default: false })
    .eq("id", row.id);
  if (error) return { ok: false, error: `No pude borrar el horario: ${error.message}` };
  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "availability_schedule", entityId: row.id, action: "schedule.deleted", metadata: { moved_events_to: decision.moveEventsTo, moved: usingIt.length }, performedBy: ctx.user.id });
  revalidatePath(PATH);
  return { ok: true };
}

/** F14: el switch "Eventos con este horario". */
export async function toggleEventSchedule(input: { scheduleId: string; eventId: string; turnOn: boolean }): Promise<ScheduleActionResult<{ changed: boolean; tooltip?: string }>> {
  const owned = await ownerOf(input.scheduleId);
  if ("error" in owned) return { ok: false, error: owned.error };
  const { ctx, row } = owned;
  const events = await listUserEventTypes(ctx.supabase, ctx.workspace.id, row.user_id);
  const event = events.find((e) => e.id === input.eventId);
  if (!event) return { ok: false, error: "No encontre ese evento" };

  const decision = decideToggleEventSchedule({ event, schedule: { id: row.id, is_default: row.is_default }, turnOn: input.turnOn });
  if (!decision.change) return { ok: true, data: { changed: false, tooltip: decision.tooltip } };

  const { error } = await ctx.supabase
    .from("event_types" as never)
    .update({ schedule_id: decision.scheduleId } as never)
    .eq("id", event.id);
  if (error) return { ok: false, error: `No pude cambiar el horario del evento: ${error.message}` };
  revalidatePath(PATH);
  return { ok: true, data: { changed: true } };
}
