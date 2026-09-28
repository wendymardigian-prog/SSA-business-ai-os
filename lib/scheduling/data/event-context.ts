/**
 * Todo lo que las pantallas de eventos necesitan de la base, en un solo
 * lugar: el perfil, los horarios, los calendarios resueltos y las categorias.
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getProfileForUser } from "./profiles";
import { listSchedules } from "./schedules";
import { listCalendarConnections, listUserCalendars } from "./calendars";
import { resolveEventCalendars, type CalendarForResolve } from "@/lib/scheduling/resolve-calendars";

type Db = SupabaseClient<Database>;

export interface EventDefaults {
  scheduleName: string | null;
  destinationCalendar: string | null;
  conflictCount: number;
  autoFlows: boolean;
  username: string | null;
  hasProfile: boolean;
  hasCalendar: boolean;
}

/** Los calendarios de la persona, ya marcados si su conexion esta caida. */
export async function calendarsForResolve(supabase: Db, workspaceId: string, userId: string): Promise<CalendarForResolve[]> {
  const [calendars, connections] = await Promise.all([
    listUserCalendars(supabase, workspaceId, userId),
    listCalendarConnections(supabase, workspaceId, userId),
  ]);
  const broken = new Set(connections.filter((c) => c.status === "revoked" || c.status === "error").map((c) => c.id));
  return calendars.map((c) => ({
    id: c.id,
    name: c.name,
    access_role: c.access_role,
    check_conflicts: c.check_conflicts,
    is_active: c.is_active,
    connection_broken: broken.has(c.connection_id),
  }));
}

/** Lo que el modal "Nuevo evento" muestra en "Se crea con lo que ya tenés configurado". */
export async function eventDefaults(
  supabase: Db,
  workspace: { id: string; scheduling_auto_create_flows?: boolean },
  userId: string,
): Promise<EventDefaults> {
  const [profile, schedules, calendars] = await Promise.all([
    getProfileForUser(supabase, workspace.id, userId),
    listSchedules(supabase, workspace.id, userId),
    calendarsForResolve(supabase, workspace.id, userId),
  ]);
  const resolved = resolveEventCalendars({}, profile ? { default_destination_calendar_id: profile.default_destination_calendar_id } : null, calendars);
  return {
    scheduleName: schedules.find((s) => s.is_default)?.name ?? schedules[0]?.name ?? null,
    destinationCalendar: resolved.destination?.name ?? null,
    conflictCount: resolved.conflicts.length,
    autoFlows: workspace.scheduling_auto_create_flows !== false,
    username: profile?.username ?? null,
    hasProfile: Boolean(profile),
    hasCalendar: calendars.some((c) => c.is_active),
  };
}
