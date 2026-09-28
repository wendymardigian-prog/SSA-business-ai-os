/**
 * Arma la entrada del motor de horarios (F24) desde la base y Google.
 *
 * El motor es puro: no sabe de Supabase ni de red. Este modulo junta lo que
 * necesita —el horario efectivo, el tiempo fuera, las agendas del anfitrion
 * con los buffers de SU evento, los conteos y el ocupado de Google— y se lo
 * pasa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AvailabilitySchedule, EventType } from "@/lib/scheduling/types";
import type { SlotsInput } from "@/lib/scheduling/slots";
import { toSchedule } from "./schedules";
import { toEventType } from "./event-types";
import { countBookings } from "@/lib/scheduling/limits/counts";
import { resolveEventCalendars } from "@/lib/scheduling/resolve-calendars";
import { calendarsForResolve } from "./event-context";
import { getBusy, type BusyInterval } from "@/lib/google-calendar/client";
import { GoogleCalendarError } from "@/lib/google-calendar/errors";
import { isUserBookable, type NotBookableReason } from "@/lib/scheduling/bookable";

type Db = SupabaseClient<Database>;

/** Cache del ocupado de Google: 60 s por (calendarios, rango). F24. */
const busyCache = new Map<string, { at: number; busy: BusyInterval[] }>();
export const BUSY_CACHE_MS = 60_000;

export function resetBusyCache(): void {
  busyCache.clear();
}

export interface SlotsContext {
  eventType: EventType;
  schedule: AvailabilitySchedule | null;
  hostUserId: string;
  hostTimezone: string;
  workspaceId: string;
  /** Titulo y ubicacion para crear la agenda sin volver a leer. */
  row: Database["public"]["Tables"]["event_types"]["Row"];
}

export type SlotsInputResult =
  | { ok: true; input: SlotsInput; context: SlotsContext }
  | { ok: false; reason: "not_found" | "temporarily_unavailable"; detail?: NotBookableReason | string };

/** El evento publico por usuario y slug, con service role (no hay policy anon). */
export async function findPublicEvent(
  service: Db,
  username: string,
  slug: string,
): Promise<{ event: Database["public"]["Tables"]["event_types"]["Row"]; profile: Database["public"]["Tables"]["scheduling_profiles"]["Row"] } | null> {
  const { data: profile } = await service
    .from("scheduling_profiles")
    .select("*")
    .ilike("username", username)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;

  const { data: event } = await service
    .from("event_types")
    .select("*")
    .eq("workspace_id", profile.workspace_id)
    .eq("owner_user_id", profile.user_id)
    .eq("slug", slug.toLowerCase())
    .is("deleted_at", null)
    .maybeSingle();
  // Activo u oculto: el oculto se llega con el link directo. Inactivo = 404.
  if (!event || event.status === "inactive") return null;
  return { event, profile };
}

export interface BuildSlotsOptions {
  from: string;
  to: string;
  inviteeTz: string;
  now?: Date;
  /** Solo el equipo (F37). */
  ignoreMinimumNotice?: boolean;
  /** Al reagendar, la propia agenda no se cuenta como ocupada (F28). */
  excludeBookingId?: string;
  /** Sin cache: la verificacion final antes de crear la agenda (F26). */
  freshGoogle?: boolean;
}

/**
 * Junta todo. Si la persona no puede recibir agendas (F7) o Google falla con
 * un error temporal, devuelve `temporarily_unavailable`: nunca se ofrecen
 * horarios sin haber leido los calendarios de conflicto.
 */
export async function buildSlotsInput(
  service: Db,
  event: Database["public"]["Tables"]["event_types"]["Row"],
  profile: Database["public"]["Tables"]["scheduling_profiles"]["Row"],
  options: BuildSlotsOptions,
): Promise<SlotsInputResult> {
  const now = options.now ?? new Date();
  const workspaceId = event.workspace_id;
  const hostId = event.owner_user_id;

  const [{ data: scheduleRows }, { data: oooRows }, calendars, { data: connections }] = await Promise.all([
    service.from("availability_schedules").select("*").eq("user_id", hostId).is("deleted_at", null),
    service.from("out_of_office").select("starts_at, ends_at").eq("user_id", hostId).is("deleted_at", null).gt("ends_at", options.from).lt("starts_at", options.to),
    calendarsForResolve(service, workspaceId, hostId),
    service.from("oauth_connections").select("id, status, granted_scopes").eq("workspace_id", workspaceId).eq("user_id", hostId).eq("provider", "google_calendar"),
  ]);

  const schedules = (scheduleRows ?? []).map((r) => toSchedule(r as never));
  const schedule = event.schedule_id ? schedules.find((s) => s.id === event.schedule_id) ?? null : schedules.find((s) => s.is_default) ?? null;

  const resolved = resolveEventCalendars(
    { destination_calendar_id: event.destination_calendar_id, conflict_calendar_ids: event.conflict_calendar_ids },
    { default_destination_calendar_id: profile.default_destination_calendar_id },
    calendars,
  );

  const bookable = isUserBookable({
    profile: { is_active: profile.is_active },
    connections: (connections ?? []).map((c) => ({ id: c.id, status: c.status, granted_scopes: c.granted_scopes })),
    calendars: calendars.map((c) => ({ id: c.id, connection_id: c.connection_id ?? "", check_conflicts: c.check_conflicts, is_active: c.is_active })),
    calendarIdsInUse: [...(event.conflict_calendar_ids ?? []), ...(event.destination_calendar_id ? [event.destination_calendar_id] : [])],
    defaultDestinationCalendarId: profile.default_destination_calendar_id,
  });
  if (!bookable.ok) return { ok: false, reason: "temporarily_unavailable", detail: bookable.reason };
  if (!schedule) return { ok: false, reason: "temporarily_unavailable", detail: "no_schedule" };

  // Las agendas activas del anfitrion en el rango, con los buffers de SU
  // evento (una agenda de otro evento bloquea con los buffers de ese otro).
  const margin = 4 * 60 * 60 * 1000;
  const { data: bookingRows } = await service
    .from("bookings")
    .select("id, start_at, end_at, event_type_id, event_types!inner(before_buffer_minutes, after_buffer_minutes)")
    .eq("host_user_id", hostId)
    .eq("status_group", "active")
    .lt("start_at", new Date(new Date(options.to).getTime() + margin).toISOString())
    .gt("end_at", new Date(new Date(options.from).getTime() - margin).toISOString());

  const bookings = ((bookingRows ?? []) as unknown as Array<{
    id: string;
    start_at: string;
    end_at: string;
    event_types: { before_buffer_minutes: number; after_buffer_minutes: number } | null;
  }>)
    .filter((b) => b.id !== options.excludeBookingId)
    .map((b) => ({
      start_at: b.start_at,
      end_at: b.end_at,
      before_buffer_minutes: b.event_types?.before_buffer_minutes ?? 0,
      after_buffer_minutes: b.event_types?.after_buffer_minutes ?? 0,
    }));

  // Los topes por dia y semana cuentan solo las agendas DE ESTE evento.
  const { data: countRows } = await service
    .from("bookings")
    .select("start_at")
    .eq("event_type_id", event.id)
    .eq("status_group", "active");
  const counts = countBookings((countRows ?? []) as Array<{ start_at: string }>, schedule.timezone);

  // El ocupado de Google. Un error temporal corta: no se ofrecen horarios.
  let busy: BusyInterval[] = [];
  if (resolved.conflicts.length > 0) {
    const byConnection = new Map<string, string[]>();
    const { data: calendarRows } = await service
      .from("calendars")
      .select("id, connection_id, external_calendar_id")
      .in("id", resolved.conflicts.map((c) => c.id));
    for (const row of calendarRows ?? []) {
      const list = byConnection.get(row.connection_id) ?? [];
      list.push(row.external_calendar_id);
      byConnection.set(row.connection_id, list);
    }

    try {
      const results = await Promise.all(
        [...byConnection.entries()].map(async ([connectionId, externalIds]) => {
          const key = `${connectionId}|${[...externalIds].sort().join(",")}|${options.from}|${options.to}`;
          if (!options.freshGoogle) {
            const hit = busyCache.get(key);
            if (hit && now.getTime() - hit.at < BUSY_CACHE_MS) return hit.busy;
          }
          const fetched = await getBusy({ supabase: service }, connectionId, externalIds, options.from, options.to);
          busyCache.set(key, { at: now.getTime(), busy: fetched });
          return fetched;
        }),
      );
      busy = results.flat();
    } catch (err) {
      if (err instanceof GoogleCalendarError) {
        return { ok: false, reason: "temporarily_unavailable", detail: err.kind };
      }
      return { ok: false, reason: "temporarily_unavailable", detail: "google_error" };
    }
  }

  const eventType = toEventType(event);
  return {
    ok: true,
    input: {
      eventType,
      schedule,
      outOfOffice: (oooRows ?? []).map((o) => ({ starts_at: o.starts_at, ends_at: o.ends_at })),
      busy,
      bookings,
      bookingCounts: counts,
      now,
      range: { from: options.from, to: options.to },
      inviteeTz: options.inviteeTz,
      ignoreMinimumNotice: options.ignoreMinimumNotice,
    },
    context: {
      eventType,
      schedule,
      hostUserId: hostId,
      hostTimezone: schedule.timezone,
      workspaceId,
      row: event,
    },
  };
}
