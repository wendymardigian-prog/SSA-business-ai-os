/**
 * Reasignar el anfitrión de una agenda (Agenda v2). El 23P01 de "la nueva
 * persona ya tenía una agenda ahí" se prueba contra la base real
 * (verify-booking-concurrency.mjs): el mock en memoria no reproduce la
 * exclusión de Postgres.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { schedulingWorld, EVENT, HOST } from "@/lib/scheduling/testing/world";
import { groupOf } from "@/lib/scheduling/booking-status";

const { reassignBookingHost } = await import("./reassign");

const ACTOR = "user-1";
const OTRO = "user-2";

function withBooking(over: Record<string, unknown> = {}, extra: { bookings?: Record<string, unknown>[]; contacts?: Record<string, unknown>[]; newHostHasProfile?: boolean } = {}) {
  const status = (over.status as string) ?? "scheduled";
  const db = schedulingWorld({
    bookings: extra.bookings ?? [
      {
        id: "bk-1",
        uid: "abcdefghijklmnopqrstuv",
        workspace_id: "ws-1",
        event_type_id: EVENT,
        host_user_id: HOST,
        contact_id: "c-1",
        title: "Llamada de triaje",
        start_at: "2026-10-01T16:00:00.000Z",
        end_at: "2026-10-01T16:30:00.000Z",
        host_timezone: "America/Costa_Rica",
        status_group: groupOf(status as never),
        google_event_id: "gev-1",
        google_connection_id: "conn-1",
        google_calendar_id: "cal-1",
        ...over,
        status,
      },
    ],
    contacts: extra.contacts ?? [{ id: "c-1", workspace_id: "ws-1", email: "juan@ejemplo.com", phone: null, setter_id: HOST, vendedor_id: HOST }],
  });
  if (extra.newHostHasProfile ?? true) {
    db.tables.scheduling_profiles.push({ id: "prof-2", workspace_id: "ws-1", user_id: OTRO, username: "lucia", display_name: "Lucía", is_active: true, timezone: "America/Mexico_City" });
  }
  return db;
}

describe("reassignBookingHost", () => {
  it("cambia el anfitrión y su zona horaria, y deja el audit", async () => {
    const db = withBooking();
    const result = await reassignBookingHost(db.client, { bookingId: "bk-1", newHostUserId: OTRO, newHostEmail: "lucia@ejemplo.com", newHostName: "Lucía", actorUserId: ACTOR });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].host_user_id).toBe(OTRO);
    expect(db.rows("bookings")[0].host_timezone).toBe("America/Mexico_City");
    expect(db.rows("audit_log").map((a) => a.action)).toContain("booking.host_changed");
  });

  it("pasa el closer y el setter si eran el anfitrión original", async () => {
    const db = withBooking();
    await reassignBookingHost(db.client, { bookingId: "bk-1", newHostUserId: OTRO, newHostEmail: "lucia@ejemplo.com", newHostName: "Lucía", actorUserId: ACTOR });
    const contact = db.rows("contacts")[0];
    expect(contact.setter_id).toBe(OTRO);
    expect(contact.vendedor_id).toBe(OTRO);
  });

  it("no toca el closer si ya era otra persona", async () => {
    const db = withBooking({}, {
      contacts: [{ id: "c-1", workspace_id: "ws-1", email: "juan@ejemplo.com", phone: null, setter_id: HOST, vendedor_id: "alguien-mas" }],
    });
    await reassignBookingHost(db.client, { bookingId: "bk-1", newHostUserId: OTRO, newHostEmail: "lucia@ejemplo.com", newHostName: "Lucía", actorUserId: ACTOR });
    expect(db.rows("contacts")[0].vendedor_id).toBe("alguien-mas");
  });

  it("con transferAssignment: false no toca al closer ni al setter", async () => {
    const db = withBooking();
    await reassignBookingHost(db.client, { bookingId: "bk-1", newHostUserId: OTRO, newHostEmail: "lucia@ejemplo.com", newHostName: "Lucía", actorUserId: ACTOR, transferAssignment: false });
    expect(db.rows("contacts")[0].setter_id).toBe(HOST);
    expect(db.rows("contacts")[0].vendedor_id).toBe(HOST);
  });

  it("encola el job de Google con el email y el nombre del nuevo anfitrión", async () => {
    const db = withBooking();
    await reassignBookingHost(db.client, { bookingId: "bk-1", newHostUserId: OTRO, newHostEmail: "lucia@ejemplo.com", newHostName: "Lucía", actorUserId: ACTOR });
    const job = db.rows("scheduled_jobs").find((j) => j.type === "booking_google_sync");
    expect(job?.payload).toMatchObject({ action: "reassign", new_host_email: "lucia@ejemplo.com", new_host_name: "Lucía" });
  });

  it("sin evento en Google, no encola nada", async () => {
    const db = withBooking({ google_event_id: null });
    await reassignBookingHost(db.client, { bookingId: "bk-1", newHostUserId: OTRO, newHostEmail: "lucia@ejemplo.com", newHostName: "Lucía", actorUserId: ACTOR });
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
  });

  it("la misma persona no se reasigna a sí misma", async () => {
    const db = withBooking();
    const result = await reassignBookingHost(db.client, { bookingId: "bk-1", newHostUserId: HOST, newHostEmail: "ana@ejemplo.com", newHostName: "Ana", actorUserId: ACTOR });
    expect(result.ok).toBe(false);
  });

  it("no se reasigna a alguien sin perfil de agenda", async () => {
    const db = withBooking({}, { newHostHasProfile: false });
    const result = await reassignBookingHost(db.client, { bookingId: "bk-1", newHostUserId: OTRO, newHostEmail: "lucia@ejemplo.com", newHostName: "Lucía", actorUserId: ACTOR });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("debía fallar");
    expect(result.message).toContain("configuró su agenda");
  });

  it("no se reasigna si la nueva persona ya tiene una agenda activa en ese horario", async () => {
    const db = withBooking({}, {
      bookings: [
        { id: "bk-1", uid: "abcdefghijklmnopqrstuv", workspace_id: "ws-1", event_type_id: EVENT, host_user_id: HOST, contact_id: "c-1", title: "T", start_at: "2026-10-01T16:00:00.000Z", end_at: "2026-10-01T16:30:00.000Z", status: "scheduled", status_group: "active" },
        { id: "bk-2", uid: "bbcdefghijklmnopqrstuv", workspace_id: "ws-1", event_type_id: EVENT, host_user_id: OTRO, contact_id: "c-1", title: "Otra", start_at: "2026-10-01T16:15:00.000Z", end_at: "2026-10-01T16:45:00.000Z", status: "scheduled", status_group: "active" },
      ],
    });
    const result = await reassignBookingHost(db.client, { bookingId: "bk-1", newHostUserId: OTRO, newHostEmail: "lucia@ejemplo.com", newHostName: "Lucía", actorUserId: ACTOR });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("debía fallar");
    expect(result.message).toContain("ya tiene una agenda activa");
  });

  it("una agenda cancelada no se reasigna", async () => {
    const db = withBooking({ status: "cancelled_other" });
    const result = await reassignBookingHost(db.client, { bookingId: "bk-1", newHostUserId: OTRO, newHostEmail: "lucia@ejemplo.com", newHostName: "Lucía", actorUserId: ACTOR });
    expect(result.ok).toBe(false);
  });
});
