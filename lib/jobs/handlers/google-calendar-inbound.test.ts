/**
 * El lector de Google Calendar (00430 + 00510) con Google simulado: la copia de la Agenda y el horizonte de 24 h de
 * la ida y vuelta. Nunca se llama a Google.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { readSecret, rescheduleBooking, cancelBooking } = vi.hoisted(() => ({
  readSecret: vi.fn(),
  rescheduleBooking: vi.fn(),
  cancelBooking: vi.fn(),
}));
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, readSecret };
});
vi.mock("@/lib/scheduling/booking/reschedule", () => ({ rescheduleBooking }));
vi.mock("@/lib/scheduling/booking/cancel", () => ({ cancelBooking }));

import { resetTokenCache } from "@/lib/google-calendar/auth";
import { syncCalendarInbound } from "./google-calendar-inbound";

const NOW = new Date("2026-11-20T12:00:00.000Z");

function db(calendar: Record<string, unknown> = {}, extra: Record<string, unknown[]> = {}) {
  return memoryDb({
    oauth_connections: [{
      id: "conn-1", workspace_id: "ws-1", user_id: "user-1", provider: "google_calendar", status: "active",
      vault_secret_prefix: "oauth_google_calendar_conn-1", token_expires_at: new Date(NOW.getTime() + 3600_000).toISOString(),
    }],
    calendars: [{
      id: "cal-1", workspace_id: "ws-1", user_id: "user-1", connection_id: "conn-1", external_calendar_id: "yo@x.com",
      sync_token: "tok-viejo", is_active: true, show_in_agenda: true, events_synced_at: null, events_sync_lock_until: null,
      ...calendar,
    }],
    bookings: [],
    scheduled_jobs: [],
    google_calendar_events: [],
    audit_log: [],
    notifications: [],
    ...extra,
  });
}

function google(items: unknown[], nextSyncToken = "tok-nuevo") {
  const calls: URL[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url);
    return new Response(JSON.stringify({ items, nextSyncToken }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTokenCache();
  readSecret.mockImplementation(async (_c: unknown, _ws: string, name: string) => (name.endsWith("_access_token") ? "access" : null));
  rescheduleBooking.mockResolvedValue({ ok: true });
  cancelBooking.mockResolvedValue({ ok: true });
});

describe("lector de Google Calendar", () => {
  it("la primera vez lee 60 días atrás (sin el token viejo) y guarda la copia", async () => {
    const d = db();
    const { fetchImpl, calls } = google([
      { id: "e1", summary: "Dentista", start: { dateTime: "2026-11-21T15:00:00Z" }, end: { dateTime: "2026-11-21T16:00:00Z" } },
      { id: "e2", status: "cancelled" },
    ]);
    const r = await syncCalendarInbound({ supabase: d.client, fetchImpl, now: () => NOW }, "cal-1");
    expect(r.error).toBeNull();
    expect(calls[0].searchParams.get("syncToken")).toBeNull();
    expect(calls[0].searchParams.get("timeMin")).toBe("2026-09-21T12:00:00.000Z");
    expect(d.tables.google_calendar_events).toHaveLength(1);
    expect(d.tables.google_calendar_events[0]).toMatchObject({ external_event_id: "e1", summary: "Dentista", booking_id: null });
    expect(d.tables.calendars[0]).toMatchObject({ sync_token: "tok-nuevo", events_synced_at: NOW.toISOString(), events_sync_lock_until: null });
  });

  it("sin «Mostrar en Agenda» no guarda nada y lee como antes (un día atrás)", async () => {
    const d = db({ show_in_agenda: false, sync_token: null });
    const { fetchImpl, calls } = google([{ id: "e1", start: { dateTime: "2026-11-21T15:00:00Z" }, end: { dateTime: "2026-11-21T16:00:00Z" } }]);
    await syncCalendarInbound({ supabase: d.client, fetchImpl, now: () => NOW }, "cal-1");
    expect(calls[0].searchParams.get("timeMin")).toBe("2026-11-19T12:00:00.000Z");
    expect(d.tables.google_calendar_events).toHaveLength(0);
  });

  it("un evento de una reunión queda en la copia con su booking_id (la Agenda no lo muestra dos veces)", async () => {
    const d = db({}, {
      bookings: [{ id: "b1", uid: "uid-1", workspace_id: "ws-1", host_user_id: "user-1", google_calendar_id: "cal-1", google_event_id: "e1", start_at: "2026-11-21T15:00:00.000Z", end_at: "2026-11-21T16:00:00.000Z", status_group: "active" }],
    });
    const { fetchImpl } = google([{ id: "e1", start: { dateTime: "2026-11-21T15:00:00Z" }, end: { dateTime: "2026-11-21T16:00:00Z" } }]);
    await syncCalendarInbound({ supabase: d.client, fetchImpl, now: () => NOW }, "cal-1");
    expect(d.tables.google_calendar_events[0]).toMatchObject({ external_event_id: "e1", booking_id: "b1" });
  });

  it("no cancela una reunión que terminó hace más de 24 h aunque su evento esté borrado en Google", async () => {
    const d = db({}, {
      bookings: [{ id: "vieja", uid: "u", workspace_id: "ws-1", host_user_id: "user-1", google_calendar_id: "cal-1", google_event_id: "e-viejo", start_at: "2026-11-10T15:00:00.000Z", end_at: "2026-11-10T16:00:00.000Z", status_group: "active" }],
    });
    const { fetchImpl } = google([{ id: "e-viejo", status: "cancelled" }]);
    const r = await syncCalendarInbound({ supabase: d.client, fetchImpl, now: () => NOW }, "cal-1");
    expect(cancelBooking).not.toHaveBeenCalled();
    expect(r.cancelled).toBe(0);
  });

  it("sigue cancelando una reunión reciente borrada en Google", async () => {
    const d = db({ events_synced_at: NOW.toISOString() }, {
      bookings: [{ id: "b1", uid: "u", workspace_id: "ws-1", host_user_id: "user-1", google_calendar_id: "cal-1", google_event_id: "e1", start_at: "2026-11-21T15:00:00.000Z", end_at: "2026-11-21T16:00:00.000Z", status_group: "active" }],
    });
    const { fetchImpl } = google([{ id: "e1", status: "cancelled" }]);
    const r = await syncCalendarInbound({ supabase: d.client, fetchImpl, now: () => NOW }, "cal-1");
    expect(cancelBooking).toHaveBeenCalledTimes(1);
    expect(r.cancelled).toBe(1);
  });

});
