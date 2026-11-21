/**
 * Lo que la Agenda carga de Google Calendar para el calendario (00510). Solo servidor.
 *
 * - Mis eventos: de la copia (`google_calendar_events`) con la SESIÓN: la RLS solo deja ver los propios.
 * - El «Ocupado» de otras personas: solo de los anfitriones elegidos en el filtro, por `google_busy_blocks` (la base
 *   decide si quien mira puede verlo).
 * Un error al leer nunca rompe la Agenda: la capa queda vacía y avisa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { canCreateEvents } from "@/lib/social/google-calendar";
import { descriptionToText, googleQueryWindow, type AgendaGoogleAttendee, type AgendaGoogleBusy, type AgendaGoogleCalendar, type AgendaGoogleEvent } from "./agenda";

export type { AgendaGoogleCalendar };

type Db = SupabaseClient<Database>;

export interface AgendaGoogleData {
  on: boolean;
  events: AgendaGoogleEvent[];
  busy: AgendaGoogleBusy[];
  /** Mis calendarios con «Mostrar en Agenda» (para el color y el nombre) y dónde se puede crear un evento. */
  calendars: AgendaGoogleCalendar[];
  /** La última lectura de mis calendarios (la más vieja de las que se muestran). null = falta la primera. */
  syncedAt: string | null;
  /** Algo falló al leer: se muestra un aviso, no datos viejos como si fueran actuales. */
  error: boolean;
  /** No tengo ningún calendario con «Mostrar en Agenda» que se pueda leer. */
  nothingToShow: boolean;
}

export const EMPTY_AGENDA_GOOGLE: AgendaGoogleData = {
  on: false,
  events: [],
  busy: [],
  calendars: [],
  syncedAt: null,
  error: false,
  nothingToShow: true,
};

const EVENT_COLUMNS =
  "id, calendar_id, external_event_id, recurring_event_id, etag, status, summary, description, location, html_link, meet_url, organizer_email, organizer_self, attendees, self_response_status, guests_can_modify, start_at, end_at, all_day, start_date, end_date, time_zone, transparency, google_event_type, booking_id";

export async function loadAgendaGoogle(input: {
  supabase: Db;
  workspaceId: string;
  userId: string;
  range: { from: string; to: string };
  /** Anfitriones del filtro: de ellos (menos yo) se pide el «Ocupado». */
  otherUserIds: string[];
  defaultDestinationId: string | null;
}): Promise<AgendaGoogleData> {
  const { supabase, workspaceId, userId } = input;
  const window = googleQueryWindow(input.range);

  try {
    const [calRes, connRes] = await Promise.all([
      supabase
        .from("calendars")
        .select("id, name, color, access_role, show_in_agenda, is_active, connection_id, events_synced_at")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .eq("is_active", true),
      supabase.from("oauth_connections").select("id, status, granted_scopes").eq("workspace_id", workspaceId).eq("user_id", userId).eq("provider", "google_calendar"),
    ]);
    if (calRes.error || connRes.error) throw new Error("read");
    const connections = new Map((connRes.data ?? []).map((c) => [c.id, c]));
    const usable = (connectionId: string) => {
      const c = connections.get(connectionId);
      return !!c && c.status !== "revoked" && c.status !== "error" && canCreateEvents(c.granted_scopes ?? []);
    };
    const calendars = (calRes.data ?? []).filter((c) => usable(c.connection_id));
    const shown = calendars.filter((c) => c.show_in_agenda);
    const calById = new Map(calendars.map((c) => [c.id, c]));

    const others = [...new Set(input.otherUserIds.filter((id) => id !== userId))];
    const [eventsRes, busyRes] = await Promise.all([
      shown.length
        ? supabase
            .from("google_calendar_events")
            .select(EVENT_COLUMNS)
            .eq("workspace_id", workspaceId)
            .eq("user_id", userId)
            .in("calendar_id", shown.map((c) => c.id))
            .lt("start_at", window.to)
            .gt("end_at", window.from)
            .order("start_at", { ascending: true })
            .limit(1500)
        : Promise.resolve({ data: [], error: null }),
      others.length
        ? supabase.rpc("google_busy_blocks", { p_workspace_id: workspaceId, p_user_ids: others, p_from: window.from, p_to: window.to })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (eventsRes.error) throw new Error("events");

    const events: AgendaGoogleEvent[] = ((eventsRes.data ?? []) as Array<Database["public"]["Tables"]["google_calendar_events"]["Row"]>)
      .filter((e) => e.status !== "cancelled")
      .map((e) => {
        const cal = calById.get(e.calendar_id);
        return {
          id: e.id,
          calendarId: e.calendar_id,
          calendarName: cal?.name ?? "Google Calendar",
          calendarColor: cal?.color ?? null,
          accessRole: cal?.access_role ?? "reader",
          externalEventId: e.external_event_id,
          recurringEventId: e.recurring_event_id,
          etag: e.etag,
          status: e.status === "tentative" ? "tentative" : "confirmed",
          summary: e.summary,
          description: descriptionToText(e.description) || null,
          location: e.location,
          htmlLink: e.html_link,
          meetUrl: e.meet_url,
          organizerEmail: e.organizer_email,
          organizerSelf: e.organizer_self,
          attendees: (Array.isArray(e.attendees) ? e.attendees : []) as unknown as AgendaGoogleAttendee[],
          selfResponse: e.self_response_status,
          guestsCanModify: e.guests_can_modify,
          startAt: e.start_at,
          endAt: e.end_at,
          allDay: e.all_day,
          startDate: e.start_date,
          endDate: e.end_date,
          timeZone: e.time_zone,
          transparency: e.transparency,
          eventType: e.google_event_type,
          bookingId: e.booking_id,
        };
      });

    // Un error del «Ocupado» (por ejemplo, sin permiso) solo deja afuera eso.
    const busy: AgendaGoogleBusy[] = (busyRes.error ? [] : (busyRes.data ?? [])).map((b, i) => ({
      key: `${b.user_id}:${b.start_at}:${i}`,
      userId: b.user_id,
      startAt: b.start_at,
      endAt: b.end_at,
      allDay: b.all_day,
      startDate: b.start_date,
      endDate: b.end_date,
    }));

    const syncedTimes = shown.map((c) => c.events_synced_at);
    const syncedAt = syncedTimes.length === 0 || syncedTimes.some((t) => !t) ? null : syncedTimes.sort()[0];

    return {
      on: true,
      events,
      busy,
      calendars: calendars
        .filter((c) => c.show_in_agenda || c.access_role === "owner" || c.access_role === "writer")
        .map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          writable: c.access_role === "owner" || c.access_role === "writer",
          isDefault: c.id === input.defaultDestinationId,
        })),
      syncedAt,
      error: false,
      nothingToShow: shown.length === 0 && busy.length === 0,
    };
  } catch {
    return { ...EMPTY_AGENDA_GOOGLE, on: true, error: true, nothingToShow: false };
  }
}
