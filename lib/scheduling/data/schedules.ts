/**
 * Lectura de horarios y tiempo fuera (B2). Solo servidor.
 *
 * Las consultas a `event_types` y `bookings` se hacen "si existen": esas
 * tablas llegan en B3 y B4a. Hasta entonces devuelven vacio, y el codigo que
 * las usa queda listo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AvailabilitySchedule, DateOverride, WeeklyHours } from "@/lib/scheduling/types";
import { parseOverrides, parseWeeklyHours } from "@/lib/scheduling/availability-schema";
import { overlapsUtc } from "@/lib/scheduling/out-of-office";

type Db = SupabaseClient<Database>;

export type ScheduleRow = Database["public"]["Tables"]["availability_schedules"]["Row"];
export type OutOfOfficeRow = Database["public"]["Tables"]["out_of_office"]["Row"];

/** La fila adaptada a la forma que esperan las funciones puras del nucleo. */
export function toSchedule(row: ScheduleRow): AvailabilitySchedule {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    timezone: row.timezone,
    is_default: row.is_default,
    weekly_hours: (parseWeeklyHours(row.weekly_hours) ?? {}) as WeeklyHours,
    date_overrides: (parseOverrides(row.date_overrides) ?? []) as DateOverride[],
  };
}

export async function listSchedules(supabase: Db, workspaceId: string, userId: string): Promise<ScheduleRow[]> {
  const { data } = await supabase
    .from("availability_schedules")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  return (data ?? []) as ScheduleRow[];
}

export async function getSchedule(supabase: Db, id: string): Promise<ScheduleRow | null> {
  const { data } = await supabase.from("availability_schedules").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as ScheduleRow | null) ?? null;
}

export async function listOutOfOffice(supabase: Db, workspaceId: string, userId: string): Promise<OutOfOfficeRow[]> {
  const { data } = await supabase
    .from("out_of_office")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("starts_at", { ascending: true });
  return (data ?? []) as OutOfOfficeRow[];
}

export interface EventUsingSchedule {
  id: string;
  title: string;
  schedule_id: string | null;
  status: string;
}

/** Los eventos de la persona (para "Lo usan:" y "Eventos con este horario"). Vacio hasta B3. */
export async function listUserEventTypes(supabase: Db, workspaceId: string, userId: string): Promise<EventUsingSchedule[]> {
  const { data, error } = await supabase
    .from("event_types" as never)
    .select("id, title, schedule_id, status")
    .eq("workspace_id", workspaceId)
    .eq("owner_user_id", userId)
    .is("deleted_at", null)
    .order("title", { ascending: true });
  if (error) return [];
  return (data ?? []) as unknown as EventUsingSchedule[];
}

export interface ConflictingBooking {
  id: string;
  start_at: string;
  end_at: string;
  contact_name: string | null;
  event_title: string | null;
}

/** Agendas activas de la persona que se superponen con un periodo (F13). Vacio hasta B4a. */
export async function conflictingBookings(
  supabase: Db,
  workspaceId: string,
  userId: string,
  period: { startsAt: string; endsAt: string },
): Promise<ConflictingBooking[]> {
  const { data, error } = await supabase
    .from("bookings" as never)
    .select("id, start_at, end_at, booker_name, title")
    .eq("workspace_id", workspaceId)
    .eq("host_user_id", userId)
    .in("status", ["scheduled", "confirmed", "rescheduled"])
    .lt("start_at", period.endsAt)
    .gt("end_at", period.startsAt);
  if (error) return [];
  return ((data ?? []) as unknown as Array<{ id: string; start_at: string; end_at: string; booker_name: string | null; title: string | null }>)
    .filter((b) => overlapsUtc({ startUtc: b.start_at, endUtc: b.end_at }, { startUtc: period.startsAt, endUtc: period.endsAt }))
    .map((b) => ({ id: b.id, start_at: b.start_at, end_at: b.end_at, contact_name: b.booker_name, event_title: b.title }));
}
