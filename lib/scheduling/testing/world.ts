/**
 * Mundo de prueba de agenda: un negocio, una persona con perfil y horario, un
 * calendario conectado y un evento publicado.
 *
 * Google esta simulado siempre. `create_booking` se reproduce en memoria con
 * lo justo para afirmar sobre lo que quedo escrito (agenda, contacto, evento
 * de automatizacion y jobs); la transaccion de verdad se prueba contra la
 * base con scripts/verify-scheduling.mjs y verify-booking-concurrency.mjs.
 */

import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { defaultWeeklyHours } from "@/lib/scheduling/availability-schema";
import { defaultBookingFields } from "@/lib/scheduling/booking-fields";
import { groupOf } from "@/lib/scheduling/booking-status";

export const WS = "ws-1";
export const HOST = "user-1";
export const EVENT = "ev-1";
export const CAL = "cal-1";
export const CONN = "conn-1";

const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export interface WorldOverrides {
  event?: Record<string, unknown>;
  profile?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  connection?: Record<string, unknown>;
  calendar?: Record<string, unknown>;
  bookings?: Record<string, unknown>[];
  contacts?: Record<string, unknown>[];
}

export function schedulingWorld(over: WorldOverrides = {}): MemoryDb {
  let seq = 0;
  const db = memoryDb(
    {
      workspaces: [{ id: WS, timezone: "America/Costa_Rica", scheduling_public_base_url: null, scheduling_auto_create_flows: true }],
      scheduling_profiles: [
        {
          id: "prof-1",
          workspace_id: WS,
          user_id: HOST,
          username: "wendy",
          display_name: "Wendy",
          is_active: true,
          default_destination_calendar_id: CAL,
          ...over.profile,
        },
      ],
      availability_schedules: [
        {
          id: "sch-1",
          workspace_id: WS,
          user_id: HOST,
          name: "Horario normal",
          timezone: "America/Costa_Rica",
          is_default: true,
          weekly_hours: defaultWeeklyHours(),
          date_overrides: [],
          deleted_at: null,
          created_at: "2026-09-01T00:00:00.000Z",
          ...over.schedule,
        },
      ],
      out_of_office: [],
      oauth_connections: [
        {
          id: CONN,
          workspace_id: WS,
          user_id: HOST,
          provider: "google_calendar",
          status: "active",
          granted_scopes: [EVENTS_SCOPE, "https://www.googleapis.com/auth/calendar.events.freebusy"],
          external_account_id: "sub-1",
          ...over.connection,
        },
      ],
      calendars: [
        {
          id: CAL,
          workspace_id: WS,
          user_id: HOST,
          connection_id: CONN,
          external_calendar_id: "wendy@ejemplo.com",
          name: "wendy@ejemplo.com",
          is_active: true,
          can_write: true,
          access_role: "owner",
          is_primary: true,
          // Sin conflictos: asi ningun test llama a Google sin querer.
          check_conflicts: false,
          ...over.calendar,
        },
      ],
      booking_categories: [
        { id: "area-1", workspace_id: WS, parent_id: null, name: "Ventas", color: "#2563eb", position: 0, is_system: true, archived_at: null },
        { id: "tipo-1", workspace_id: WS, parent_id: "area-1", name: "Triaje", color: null, position: 0, is_system: true, archived_at: null },
      ],
      event_types: [
        {
          id: EVENT,
          workspace_id: WS,
          owner_user_id: HOST,
          category_id: "tipo-1",
          title: "Llamada de triaje",
          slug: "llamada-de-triaje",
          description_md: null,
          duration_minutes: 30,
          color: null,
          location_type: "google_meet",
          location_text: null,
          hide_location_until_booked: false,
          status: "active",
          schedule_id: "sch-1",
          destination_calendar_id: null,
          conflict_calendar_ids: [],
          before_buffer_minutes: 0,
          after_buffer_minutes: 0,
          minimum_notice_minutes: 60,
          slot_interval_minutes: 30,
          max_per_day: null,
          max_per_week: null,
          period_type: "rolling",
          period_days: 60,
          period_start_date: null,
          period_end_date: null,
          contact_assignment: "none",
          success_redirect_url: null,
          redirect_with_params: false,
          booking_fields: defaultBookingFields(),
          unavailable_messages: null,
          deleted_at: null,
          ...over.event,
        },
      ],
      bookings: over.bookings ?? [],
      contacts: over.contacts ?? [],
      automation_events: [],
      scheduled_jobs: [],
      audit_log: [],
      notifications: [],
      rate_limits: [],
    },
    {
      joins: {
        "bookings.event_types": (row, d) => d.rows("event_types").find((e) => e.id === row.event_type_id) ?? null,
      },
      rpc: {
        /** Lo esencial de la transaccion, para poder afirmar sobre el resultado. */
        create_booking: (args, d) => {
          const start = args.p_start_at as string;
          const hostId = args.p_host_user_id as string;
          // La exclusion: el mismo anfitrion, el mismo rango, agenda activa.
          const clash = d.rows("bookings").some(
            (b) =>
              b.host_user_id === hostId &&
              b.status_group === "active" &&
              new Date(b.start_at as string) < new Date(args.p_end_at as string) &&
              new Date(b.end_at as string) > new Date(start),
          );
          if (clash) throw Object.assign(new Error("conflicting key value violates exclusion constraint"), { code: "23P01" });

          let contactId = (args.p_contact_id as string | null) ?? null;
          let created = false;
          if (!contactId) {
            const phone = args.p_phone as string | null;
            const email = args.p_email as string | null;
            const found =
              (phone ? d.rows("contacts").find((c) => c.phone === phone) : null) ??
              (email ? d.rows("contacts").find((c) => c.email === email) : null);
            if (found) {
              contactId = found.id as string;
            } else {
              contactId = `contact-${++seq}`;
              created = true;
              d.rows("contacts").push({
                id: contactId,
                workspace_id: args.p_workspace_id,
                name: args.p_name,
                email,
                phone,
                timezone: args.p_timezone,
                do_not_contact: false,
                setter_id: null,
                vendedor_id: null,
                attribution: { source: "scheduling", ...(args.p_utm as object) },
              });
            }
          }

          const status = "scheduled";
          const bookingId = `bk-${++seq}`;
          d.rows("bookings").push({
            id: bookingId,
            uid: args.p_uid,
            workspace_id: args.p_workspace_id,
            event_type_id: args.p_event_type_id,
            host_user_id: hostId,
            contact_id: contactId,
            title: args.p_title,
            start_at: start,
            end_at: args.p_end_at,
            timezone: args.p_timezone,
            host_timezone: args.p_host_timezone,
            status,
            status_group: groupOf(status),
            booker_name: args.p_name,
            booker_email: args.p_email,
            booker_phone: args.p_phone,
            responses: args.p_responses,
            origin: args.p_origin,
            location_type: args.p_location_type,
            location_text: args.p_location_text,
            category_id: args.p_category_id,
            category_snapshot: args.p_category_snapshot,
            utm: args.p_utm,
            referrer_url: args.p_referrer_url,
            metadata: args.p_metadata,
            created_by: args.p_created_by,
            reschedule_count: 0,
            google_sync_status: "pending",
          });

          d.rows("audit_log").push({ workspace_id: args.p_workspace_id, entity_type: "booking", entity_id: bookingId, action: "booking.created" });
          d.rows("automation_events").push({
            workspace_id: args.p_workspace_id,
            event_type: "booking_created",
            contact_id: contactId,
            payload: { booking_id: bookingId, event_type_id: args.p_event_type_id, host_user_id: hostId, origin: args.p_origin },
          });
          d.rows("scheduled_jobs").push({ type: "booking_google_sync", payload: { booking_id: bookingId, action: "create", attempt: 0 }, run_at: new Date().toISOString(), status: "pending" });
          d.rows("scheduled_jobs").push({ type: "booking_ended", payload: { booking_id: bookingId }, run_at: args.p_end_at, status: "pending" });

          return { booking_id: bookingId, uid: args.p_uid, contact_id: contactId, created_contact: created, assignment_changed: false };
        },
        bump_rate_limit: (args, d) => {
          const key = args.p_key as string;
          const row = d.rows("rate_limits").find((r) => r.key === key);
          if (row) {
            row.hits = (row.hits as number) + 1;
            return row.hits;
          }
          d.rows("rate_limits").push({ key, hits: 1, window_start: args.p_window_start });
          return 1;
        },
      },
    },
  );
  return db;
}
