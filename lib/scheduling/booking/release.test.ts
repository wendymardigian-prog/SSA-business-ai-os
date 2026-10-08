/**
 * Liberar y volver a ocupar el espacio de una agenda (Agenda v2). El 23P01
 * de "ya lo tomó otra agenda" se prueba contra la base real
 * (scripts/verify-booking-concurrency.mjs): el mock en memoria no reproduce
 * la exclusión de Postgres fuera de `create_booking`.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { schedulingWorld, EVENT, HOST } from "@/lib/scheduling/testing/world";
import { groupOf } from "@/lib/scheduling/booking-status";

const { releaseBookingSlot, occupyBookingSlot } = await import("./release");

const ACTOR = "user-1";

function withBooking(over: Record<string, unknown> = {}) {
  const status = (over.status as string) ?? "scheduled";
  return schedulingWorld({
    bookings: [
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
        status_group: groupOf(status as never),
        slot_released_at: null,
        slot_released_by: null,
        google_event_id: "gev-1",
        ...over,
        status,
      },
    ],
    contacts: [{ id: "c-1", workspace_id: "ws-1", email: "juan@ejemplo.com", phone: null }],
  });
}

describe("releaseBookingSlot", () => {
  it("marca slot_released_at/by y deja el audit", async () => {
    const db = withBooking();
    const result = await releaseBookingSlot(db.client, "bk-1", ACTOR);
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].slot_released_at).toBeTruthy();
    expect(db.rows("bookings")[0].slot_released_by).toBe(ACTOR);
    expect(db.rows("audit_log").map((a) => a.action)).toContain("booking.slot_released");
  });

  it("encola el job de Google solo si ya hay evento sincronizado", async () => {
    const db = withBooking({ google_event_id: null });
    await releaseBookingSlot(db.client, "bk-1", ACTOR);
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
  });

  it("con evento en Google, encola el job de release", async () => {
    const db = withBooking();
    await releaseBookingSlot(db.client, "bk-1", ACTOR);
    const job = db.rows("scheduled_jobs").find((j) => j.type === "booking_google_sync");
    expect(job?.payload).toMatchObject({ booking_id: "bk-1", action: "release" });
  });

  it("liberar dos veces no duplica nada: la segunda es un no-op exitoso", async () => {
    const db = withBooking();
    await releaseBookingSlot(db.client, "bk-1", ACTOR);
    db.tables.scheduled_jobs = [];
    db.tables.audit_log = [];
    const result = await releaseBookingSlot(db.client, "bk-1", ACTOR);
    expect(result.ok).toBe(true);
    expect(db.rows("scheduled_jobs")).toHaveLength(0);
    expect(db.rows("audit_log")).toHaveLength(0);
  });

  it("una agenda cancelada no se libera", async () => {
    const db = withBooking({ status: "cancelled_other" });
    const result = await releaseBookingSlot(db.client, "bk-1", ACTOR);
    expect(result.ok).toBe(false);
  });

  it("una agenda que no existe da 404", async () => {
    const db = withBooking();
    const result = await releaseBookingSlot(db.client, "no-existe", ACTOR);
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});

describe("occupyBookingSlot", () => {
  it("vuelve a ocupar: limpia slot_released_at/by y deja el audit", async () => {
    const db = withBooking({ slot_released_at: "2026-10-01T10:00:00.000Z", slot_released_by: ACTOR });
    const result = await occupyBookingSlot(db.client, "bk-1", ACTOR);
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].slot_released_at).toBeNull();
    expect(db.rows("bookings")[0].slot_released_by).toBeNull();
    expect(db.rows("audit_log").map((a) => a.action)).toContain("booking.slot_occupied");
  });

  it("ocupar una agenda que nunca se liberó es un no-op, sin audit", async () => {
    const db = withBooking();
    const result = await occupyBookingSlot(db.client, "bk-1", ACTOR);
    expect(result.ok).toBe(true);
    expect(db.rows("audit_log")).toHaveLength(0);
  });
});
