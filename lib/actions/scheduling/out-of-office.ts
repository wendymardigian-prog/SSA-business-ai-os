"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { OUT_OF_OFFICE_REASONS, outOfOfficeToUtc, type OutOfOfficeInput } from "@/lib/scheduling/out-of-office";
import { conflictingBookings, type ConflictingBooking } from "@/lib/scheduling/data/schedules";
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import type { OutOfOfficeReason } from "@/lib/types/database";

/**
 * Tiempo fuera (F13). Es de la persona y bloquea todos sus horarios. Antes de
 * guardar, la pantalla pregunta por las agendas activas del periodo: se
 * avisan, no se cancelan.
 */

const PATH = "/dashboard/agenda/configuracion/disponibilidad";

export type OutOfOfficeActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

export interface OutOfOfficeForm extends OutOfOfficeInput {
  id?: string | null;
  reason: OutOfOfficeReason;
  note?: string | null;
  forUserId?: string | null;
}

async function target(forUserId: string | null | undefined) {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { error: "No tenes permiso para tener una agenda" as string, ctx: null } as const;
  const userId = forUserId && forUserId !== ctx.user.id ? forUserId : ctx.user.id;
  if (userId !== ctx.user.id && !ctx.can("scheduling.manage_others")) {
    return { error: "No tenes permiso para editar el tiempo fuera de otra persona" as string, ctx: null } as const;
  }
  const profile = await getProfileForUser(ctx.supabase, ctx.workspace.id, userId);
  const timezone = profile?.timezone ?? ((ctx.workspace as { timezone?: string }).timezone ?? "UTC");
  return { ctx, userId, timezone, error: null } as const;
}

/** Las agendas activas que caen en el periodo (para el aviso previo, F13). */
export async function previewOutOfOfficeConflicts(input: OutOfOfficeInput & { forUserId?: string | null }): Promise<OutOfOfficeActionResult<{ startsAt: string; endsAt: string; conflictingBookings: ConflictingBooking[] }>> {
  const t = await target(input.forUserId);
  if (!t.ctx) return { ok: false, error: t.error };
  const utc = outOfOfficeToUtc(input, t.timezone);
  if (!utc.ok) return { ok: false, error: utc.error };
  const conflicts = await conflictingBookings(t.ctx.supabase, t.ctx.workspace.id, t.userId, { startsAt: utc.startsAt, endsAt: utc.endsAt });
  return { ok: true, data: { startsAt: utc.startsAt, endsAt: utc.endsAt, conflictingBookings: conflicts } };
}

export async function saveOutOfOffice(input: OutOfOfficeForm): Promise<OutOfOfficeActionResult<{ id: string; conflictingBookings: ConflictingBooking[] }>> {
  const t = await target(input.forUserId);
  if (!t.ctx) return { ok: false, error: t.error };
  const { ctx, userId, timezone } = t;

  if (!OUT_OF_OFFICE_REASONS.includes(input.reason)) return { ok: false, error: "El motivo no es valido" };
  const utc = outOfOfficeToUtc(input, timezone);
  if (!utc.ok) return { ok: false, error: utc.error };
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
  const row = { starts_at: utc.startsAt, ends_at: utc.endsAt, all_day: input.allDay, reason: input.reason, note };

  let id = input.id ?? null;
  if (id) {
    const { data, error } = await ctx.supabase
      .from("out_of_office")
      .update(row)
      .eq("id", id)
      .eq("workspace_id", ctx.workspace.id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (error || !data) return { ok: false, error: "No pude guardar el tiempo fuera" };
    await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "out_of_office", entityId: id, action: "out_of_office.updated", performedBy: ctx.user.id });
  } else {
    const { data, error } = await ctx.supabase
      .from("out_of_office")
      .insert({ ...row, workspace_id: ctx.workspace.id, user_id: userId })
      .select("id")
      .maybeSingle();
    if (error || !data) return { ok: false, error: `No pude guardar el tiempo fuera: ${error?.message ?? ""}` };
    id = data.id;
    await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "out_of_office", entityId: id, action: "out_of_office.created", metadata: { reason: input.reason, all_day: input.allDay }, performedBy: ctx.user.id });
  }

  const conflicts = await conflictingBookings(ctx.supabase, ctx.workspace.id, userId, { startsAt: utc.startsAt, endsAt: utc.endsAt });
  revalidatePath(PATH);
  return { ok: true, data: { id, conflictingBookings: conflicts } };
}

export async function deleteOutOfOffice(input: { id: string; forUserId?: string | null }): Promise<OutOfOfficeActionResult> {
  const t = await target(input.forUserId);
  if (!t.ctx) return { ok: false, error: t.error };
  const { data, error } = await t.ctx.supabase
    .from("out_of_office")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("workspace_id", t.ctx.workspace.id)
    .eq("user_id", t.userId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "No pude borrar el tiempo fuera" };
  await logAudit({ supabase: t.ctx.supabase, workspaceId: t.ctx.workspace.id, entityType: "out_of_office", entityId: input.id, action: "out_of_office.deleted", performedBy: t.ctx.user.id });
  revalidatePath(PATH);
  return { ok: true };
}
