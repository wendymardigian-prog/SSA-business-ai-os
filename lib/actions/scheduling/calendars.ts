"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { GoogleCalendarError } from "@/lib/google-calendar/errors";
import { syncCalendars, disconnectCalendarConnection } from "@/lib/scheduling/data/calendars";
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import { isWritable } from "@/lib/scheduling/calendars";

/**
 * Calendarios de Google de la persona (F5). Todo lo que toca una cuenta de
 * Google es SOLO de su dueña: ni `scheduling.manage_others` alcanza (§5:
 * nadie conecta, desconecta ni ve los tokens de otra persona).
 */

const CALENDARS_PATH = "/dashboard/agenda/configuracion/calendarios";

export type CalendarActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

async function ownConnection(connectionId: string) {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ctx: null, connection: null, error: "No tenes permiso para tener una agenda" } as const;
  const service = await createServiceClient();
  const { data: connection } = await service
    .from("oauth_connections")
    .select("id, workspace_id, user_id, provider, vault_secret_prefix, account_label")
    .eq("id", connectionId)
    .eq("workspace_id", ctx.workspace.id)
    .eq("provider", "google_calendar")
    .maybeSingle();
  if (!connection || connection.user_id !== ctx.user.id) {
    return { ctx: null, connection: null, error: "Esa cuenta de Google no es tuya" } as const;
  }
  return { ctx, connection: connection as typeof connection & { user_id: string }, service, error: null } as const;
}

/** "Reconectar" sin volver a pasar por Google: relee la lista de calendarios. */
export async function resyncCalendars(connectionId: string): Promise<CalendarActionResult<{ inserted: number; deactivated: number }>> {
  const { ctx, connection, service, error } = await ownConnection(connectionId);
  if (!ctx) return { ok: false, error };
  try {
    const result = await syncCalendars({ supabase: service }, connection.id);
    revalidatePath(CALENDARS_PATH);
    return { ok: true, data: { inserted: result.inserted, deactivated: result.deactivated } };
  } catch (err) {
    if (err instanceof GoogleCalendarError && err.kind === "permanent") {
      return { ok: false, error: "Google ya no da acceso a esta cuenta. Reconectala con el boton Reconectar." };
    }
    return { ok: false, error: "Google no respondio. Proba de nuevo en un rato." };
  }
}

export async function setCalendarCheckConflicts(calendarId: string, checkConflicts: boolean): Promise<CalendarActionResult> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ok: false, error: "No tenes permiso para tener una agenda" };
  // RLS: solo la dueña puede actualizar sus calendarios.
  const { data, error } = await ctx.supabase
    .from("calendars")
    .update({ check_conflicts: checkConflicts })
    .eq("id", calendarId)
    .eq("user_id", ctx.user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "No pude cambiar ese calendario" };
  revalidatePath(CALENDARS_PATH);
  return { ok: true };
}

export async function setDefaultDestinationCalendar(calendarId: string | null): Promise<CalendarActionResult> {
  const ctx = await getPermissionAction("scheduling.use");
  if (!ctx) return { ok: false, error: "No tenes permiso para tener una agenda" };
  const profile = await getProfileForUser(ctx.supabase, ctx.workspace.id, ctx.user.id);
  if (!profile) return { ok: false, error: "Primero guarda tu usuario y tu zona horaria en Ajustes" };

  if (calendarId) {
    const { data: cal } = await ctx.supabase
      .from("calendars")
      .select("id, access_role, is_active, user_id")
      .eq("id", calendarId)
      .maybeSingle();
    if (!cal || cal.user_id !== ctx.user.id || !cal.is_active) return { ok: false, error: "Ese calendario no esta disponible" };
    if (!isWritable(cal.access_role)) return { ok: false, error: "Ese calendario es de solo lectura: no se pueden crear eventos ahi" };
  }

  const { error } = await ctx.supabase
    .from("scheduling_profiles")
    .update({ default_destination_calendar_id: calendarId })
    .eq("id", profile.id);
  if (error) return { ok: false, error: `No pude guardar el destino: ${error.message}` };
  revalidatePath(CALENDARS_PATH);
  return { ok: true };
}

/** Cuantos eventos usan calendarios de esta cuenta (para el aviso de desconectar). */
export async function countEventsUsingConnection(connectionId: string): Promise<CalendarActionResult<{ events: number; calendars: number }>> {
  const { ctx, connection, service, error } = await ownConnection(connectionId);
  if (!ctx) return { ok: false, error };
  const { data: cals } = await service.from("calendars").select("id").eq("connection_id", connection.id).eq("is_active", true);
  const ids = (cals ?? []).map((c) => c.id);
  let events = 0;
  if (ids.length > 0) {
    // event_types llega en B3: hasta entonces la consulta falla y se cuenta 0.
    const { count } = await service
      .from("event_types" as never)
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspace.id)
      .is("deleted_at", null)
      .or(`destination_calendar_id.in.(${ids.join(",")}),conflict_calendar_ids.ov.{${ids.join(",")}}`);
    events = count ?? 0;
  }
  return { ok: true, data: { events, calendars: ids.length } };
}

export async function disconnectGoogleCalendar(connectionId: string): Promise<CalendarActionResult<{ calendars: number }>> {
  const { ctx, connection, service, error } = await ownConnection(connectionId);
  if (!ctx) return { ok: false, error };

  const result = await disconnectCalendarConnection(service, {
    id: connection.id,
    workspace_id: connection.workspace_id,
    user_id: connection.user_id,
    vault_secret_prefix: connection.vault_secret_prefix,
  });

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "oauth_connection",
    entityId: connection.id,
    action: "google_calendar.disconnected",
    metadata: { account_label: connection.account_label, calendars: result.calendars },
    performedBy: ctx.user.id,
  });
  revalidatePath(CALENDARS_PATH);
  return { ok: true, data: { calendars: result.calendars } };
}
