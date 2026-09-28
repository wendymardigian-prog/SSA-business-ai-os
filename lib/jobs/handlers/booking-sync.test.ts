/**
 * Los jobs de agenda: que el evento llegue a Google, que un error temporal se
 * reintente a 1, 5 y 15 minutos, y que uno permanente avise a la persona.
 *
 * Google esta simulado: ningun test toca la red.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { GoogleCalendarError } from "@/lib/google-calendar/errors";

const createEvent = vi.fn();
const updateEvent = vi.fn();
const deleteEvent = vi.fn();

vi.mock("@/lib/google-calendar/client", () => ({
  createEvent: (...args: unknown[]) => createEvent(...args),
  updateEvent: (...args: unknown[]) => updateEvent(...args),
  deleteEvent: (...args: unknown[]) => deleteEvent(...args),
}));

const {
  handleBookingGoogleSync,
  handleBookingEnded,
  nextSyncRunAt,
  buildDescription,
  SYNC_RETRY_MINUTES,
} = await import("./booking-sync");

const WS = "ws-1";
const HOST = "user-1";

function world(booking: Record<string, unknown> = {}) {
  return memoryDb({
    workspaces: [{ id: WS, scheduling_public_base_url: "https://agenda.ejemplo.com" }],
    scheduling_profiles: [{ workspace_id: WS, user_id: HOST, default_destination_calendar_id: "cal-1" }],
    calendars: [
      {
        id: "cal-1",
        workspace_id: WS,
        user_id: HOST,
        connection_id: "conn-1",
        external_calendar_id: "wendy@ejemplo.com",
        is_active: true,
        can_write: true,
        access_role: "owner",
        is_primary: true,
      },
    ],
    event_types: [{ id: "ev-1", destination_calendar_id: null, conflict_calendar_ids: [], location_type: "google_meet" }],
    bookings: [
      {
        id: "bk-1",
        uid: "abcdefghijklmnopqrstuv",
        workspace_id: WS,
        host_user_id: HOST,
        event_type_id: "ev-1",
        title: "Llamada de triaje",
        start_at: "2026-10-01T15:00:00.000Z",
        end_at: "2026-10-01T15:30:00.000Z",
        host_timezone: "America/Costa_Rica",
        status: "scheduled",
        status_group: "upcoming",
        booker_name: "Juan Pérez",
        booker_email: "juan@ejemplo.com",
        booker_phone: "+50688887777",
        responses: { name: "Juan Pérez", email: "juan@ejemplo.com", notas: "Vengo de Instagram" },
        location_type: "google_meet",
        location_text: null,
        google_event_id: null,
        google_connection_id: null,
        google_calendar_id: null,
        meet_url: null,
        contact_id: "c-1",
        origin: "public",
        ...booking,
      },
    ],
    scheduled_jobs: [],
    audit_log: [],
    notifications: [],
  });
}

const ctx = (db: ReturnType<typeof memoryDb>, payload: Record<string, unknown>) => ({
  supabase: db.client,
  job: { id: "job-1", type: "booking_google_sync", payload, attempts: 0 },
});

beforeEach(() => {
  createEvent.mockReset();
  updateEvent.mockReset();
  deleteEvent.mockReset();
});

describe("nextSyncRunAt", () => {
  it("reintenta a 1, 5 y 15 minutos y despues se rinde", () => {
    const now = new Date("2026-10-01T12:00:00.000Z");
    expect(SYNC_RETRY_MINUTES).toEqual([1, 5, 15]);
    expect(nextSyncRunAt(0, now)?.toISOString()).toBe("2026-10-01T12:01:00.000Z");
    expect(nextSyncRunAt(1, now)?.toISOString()).toBe("2026-10-01T12:05:00.000Z");
    expect(nextSyncRunAt(2, now)?.toISOString()).toBe("2026-10-01T12:15:00.000Z");
    expect(nextSyncRunAt(3, now)).toBeNull();
  });
});

describe("buildDescription", () => {
  it("pone el contacto, las respuestas y los dos enlaces", () => {
    const text = buildDescription({
      bookerName: "Juan",
      bookerEmail: "juan@ejemplo.com",
      bookerPhone: null,
      responses: { name: "Juan", email: "juan@ejemplo.com", notas: "Hola" },
      manageUrl: "https://agenda.ejemplo.com/calendario/agenda/abc",
    });
    expect(text).toContain("Contacto: Juan");
    expect(text).toContain("· notas: Hola");
    // El nombre y el email no se repiten como respuesta.
    expect(text).not.toContain("· name:");
    expect(text).toContain("https://agenda.ejemplo.com/calendario/agenda/abc/reagendar");
  });
});

describe("handleBookingGoogleSync · crear", () => {
  it("crea el evento y guarda el id, el iCalUID y el Meet", async () => {
    const db = world();
    createEvent.mockResolvedValue({ eventId: "gev-1", iCalUID: "gev-1@google.com", meetUrl: "https://meet.google.com/abc-defg-hij" });

    await handleBookingGoogleSync(ctx(db, { booking_id: "bk-1", action: "create" }));

    expect(createEvent).toHaveBeenCalledTimes(1);
    const [, connectionId, externalId, body] = createEvent.mock.calls[0];
    expect(connectionId).toBe("conn-1");
    expect(externalId).toBe("wendy@ejemplo.com");
    expect(body).toMatchObject({ bookingUid: "abcdefghijklmnopqrstuv", attendeeEmail: "juan@ejemplo.com", timeZone: "America/Costa_Rica" });
    expect(body.location).toEqual({ kind: "google_meet" });

    const booking = db.rows("bookings")[0];
    expect(booking.google_event_id).toBe("gev-1");
    expect(booking.ical_uid).toBe("gev-1@google.com");
    expect(booking.meet_url).toBe("https://meet.google.com/abc-defg-hij");
    expect(booking.google_sync_status).toBe("synced");
    expect(db.rows("audit_log").map((r) => r.action)).toContain("booking.sync_ok");
  });

  it("sin calendario destino no reintenta: queda no aplicable", async () => {
    const db = world();
    db.tables.calendars = [];
    db.tables.scheduling_profiles[0].default_destination_calendar_id = null;

    await handleBookingGoogleSync(ctx(db, { booking_id: "bk-1", action: "create" }));

    expect(createEvent).not.toHaveBeenCalled();
    expect(db.rows("bookings")[0].google_sync_status).toBe("not_applicable");
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
  });

  it("una agenda cancelada no se crea", async () => {
    const db = world({ status: "cancelled_invitee", status_group: "cancelled" });
    await handleBookingGoogleSync(ctx(db, { booking_id: "bk-1", action: "create" }));
    expect(createEvent).not.toHaveBeenCalled();
  });
});

describe("handleBookingGoogleSync · errores", () => {
  it("un error temporal reagenda el intento siguiente y no marca fallida", async () => {
    const db = world();
    createEvent.mockRejectedValue(new GoogleCalendarError("Google no da más", "temporary", 503, "backendError"));

    await handleBookingGoogleSync(ctx(db, { booking_id: "bk-1", action: "create", attempt: 0 }));

    const jobs = db.rows("scheduled_jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe("booking_google_sync");
    expect(jobs[0].payload).toMatchObject({ booking_id: "bk-1", action: "create", attempt: 1 });
    expect(db.rows("bookings")[0].google_sync_status).not.toBe("failed");
    expect(db.rows("notifications")).toHaveLength(0);
  });

  it("agotados los tres reintentos, marca fallida y avisa a la persona", async () => {
    const db = world();
    createEvent.mockRejectedValue(new GoogleCalendarError("Google no da más", "temporary", 503, "backendError"));

    await handleBookingGoogleSync(ctx(db, { booking_id: "bk-1", action: "create", attempt: 3 }));

    expect(db.rows("scheduled_jobs")).toHaveLength(0);
    expect(db.rows("bookings")[0].google_sync_status).toBe("failed");
    expect(db.rows("audit_log").map((r) => r.action)).toContain("booking.sync_failed");
    const notif = db.rows("notifications")[0];
    expect(notif.type).toBe("booking_sync_failed");
    expect(notif.recipient_id).toBe(HOST);
  });

  it("un error permanente no reintenta ni una vez", async () => {
    const db = world();
    createEvent.mockRejectedValue(new GoogleCalendarError("Sin permisos", "permanent", 403, "insufficientPermissions"));

    await handleBookingGoogleSync(ctx(db, { booking_id: "bk-1", action: "create", attempt: 0 }));

    expect(db.rows("scheduled_jobs")).toHaveLength(0);
    expect(db.rows("bookings")[0].google_sync_status).toBe("failed");
  });
});

describe("handleBookingGoogleSync · mover y borrar", () => {
  it("mover manda el rango nuevo al evento que ya existe", async () => {
    const db = world({
      google_event_id: "gev-1",
      google_connection_id: "conn-1",
      google_calendar_id: "cal-1",
      start_at: "2026-10-02T16:00:00.000Z",
      end_at: "2026-10-02T16:30:00.000Z",
    });
    updateEvent.mockResolvedValue({ eventId: "gev-1", meetUrl: null });

    await handleBookingGoogleSync(ctx(db, { booking_id: "bk-1", action: "update" }));

    const [, , , eventId, body] = updateEvent.mock.calls[0];
    expect(eventId).toBe("gev-1");
    expect(body).toMatchObject({ startUtc: "2026-10-02T16:00:00.000Z" });
    expect(db.rows("bookings")[0].google_sync_status).toBe("synced");
  });

  it("borrar deja la marca de borrado, incluso si la agenda esta cancelada", async () => {
    const db = world({
      status: "cancelled_invitee",
      status_group: "cancelled",
      google_event_id: "gev-1",
      google_connection_id: "conn-1",
      google_calendar_id: "cal-1",
    });
    deleteEvent.mockResolvedValue(undefined);

    await handleBookingGoogleSync(ctx(db, { booking_id: "bk-1", action: "delete" }));

    expect(deleteEvent).toHaveBeenCalledTimes(1);
    expect(db.rows("bookings")[0].google_event_deleted_at).toBeTruthy();
  });

  it("borrar sin evento en Google no falla", async () => {
    const db = world();
    await handleBookingGoogleSync(ctx(db, { booking_id: "bk-1", action: "delete" }));
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(db.rows("bookings")[0].google_sync_status).toBe("synced");
  });
});

describe("handleBookingEnded", () => {
  it("emite booking_ended con el evento y el anfitrion", async () => {
    const db = world();
    db.tables.automation_events = [];
    await handleBookingEnded({ supabase: db.client, job: { id: "j", type: "booking_ended", payload: { booking_id: "bk-1" }, attempts: 0 } });

    const events = db.rows("automation_events");
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("booking_ended");
    expect(events[0].contact_id).toBe("c-1");
    expect(events[0].payload).toMatchObject({ booking_id: "bk-1", event_type_id: "ev-1", host_user_id: HOST, origin: "public" });
  });

  it("una agenda cancelada no emite nada", async () => {
    const db = world({ status: "cancelled_invitee", status_group: "cancelled" });
    db.tables.automation_events = [];
    await handleBookingEnded({ supabase: db.client, job: { id: "j", type: "booking_ended", payload: { booking_id: "bk-1" }, attempts: 0 } });
    expect(db.rows("automation_events")).toHaveLength(0);
  });
});
