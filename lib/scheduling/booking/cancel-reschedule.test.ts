/**
 * Cancelar y reagendar (F28, F36): quien puede, cuando ya no, y que queda
 * escrito. Google esta simulado.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { schedulingWorld, EVENT, HOST } from "@/lib/scheduling/testing/world";
import { resetBusyCache } from "@/lib/scheduling/data/slots-input";
import { groupOf } from "@/lib/scheduling/booking-status";

const notifyBooking = vi.fn(async () => {});
vi.mock("@/lib/scheduling/notifications", () => ({ notifyBooking: (...a: unknown[]) => notifyBooking(...(a as [])) }));

const { cancelBooking, cancelPendingJobs } = await import("./cancel");
const { rescheduleBooking } = await import("./reschedule");

const NOW = new Date("2026-09-30T16:00:00.000Z");
const START = "2026-10-01T16:00:00.000Z";

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
        start_at: START,
        end_at: "2026-10-01T16:30:00.000Z",
        booker_timezone: "America/Costa_Rica",
        host_timezone: "America/Costa_Rica",
        booker_name: "Juan",
        booker_email: "juan@ejemplo.com",
        booker_phone: null,
        responses: {},
        origin: "public_page",
        location_type: "google_meet",
        location_text: null,
        reschedule_count: 0,
        google_event_id: "gev-1",
        ...over,
        status,
        status_group: groupOf(status as never),
      },
    ],
    contacts: [{ id: "c-1", workspace_id: "ws-1", email: "juan@ejemplo.com", phone: null }],
  });
}

beforeEach(() => {
  resetBusyCache();
  notifyBooking.mockClear();
});

describe("cancelBooking · el invitado", () => {
  it("cancela con el codigo publico y queda todo registrado", async () => {
    const db = withBooking();
    db.rows("scheduled_jobs").push({ id: "j1", type: "booking_ended", payload: { booking_id: "bk-1" }, status: "pending", run_at: "2026-10-01T16:30:00.000Z" });

    const result = await cancelBooking(db.client, { uid: "abcdefghijklmnopqrstuv", by: "invitee", reason: "Me surgió otra cosa", now: NOW });
    expect(result).toMatchObject({ ok: true, bookingId: "bk-1" });

    const bk = db.rows("bookings")[0];
    expect(bk.status).toBe("cancelled_other");
    expect(bk.cancelled_by_type).toBe("invitee");
    expect(bk.cancellation_reason).toBe("Me surgió otra cosa");
    // Quien cancela no queda como usuario del equipo.
    expect(bk.cancelled_by_user_id).toBeNull();

    expect(db.rows("audit_log").map((a) => a.action)).toContain("booking.cancelled");
    const evento = db.rows("automation_events").find((e) => e.event_type === "booking_cancelled");
    expect(evento?.payload).toMatchObject({ booking_id: "bk-1", by_whom: "invitee" });

    // El aviso de fin ya no corre y se manda el borrado a Google.
    expect(db.rows("scheduled_jobs").find((j) => j.id === "j1")?.status).toBe("cancelled");
    const sync = db.rows("scheduled_jobs").find((j) => j.type === "booking_google_sync");
    expect(sync?.payload).toMatchObject({ action: "delete" });

    expect(notifyBooking).toHaveBeenCalledWith(expect.anything(), "bk-1", "booking_cancelled", { actorUserId: null });
  });

  it("no cancela una reunion que ya empezo", async () => {
    const db = withBooking();
    const result = await cancelBooking(db.client, { uid: "abcdefghijklmnopqrstuv", by: "invitee", now: new Date("2026-10-01T16:05:00.000Z") });
    expect(result).toMatchObject({ ok: false, status: 409, reason: "too_late" });
    expect(db.rows("bookings")[0].status).toBe("scheduled");
  });

  it("no cancela dos veces", async () => {
    const db = withBooking({ status: "cancelled_other" });
    const result = await cancelBooking(db.client, { uid: "abcdefghijklmnopqrstuv", by: "invitee", now: NOW });
    expect(result).toMatchObject({ ok: false, reason: "too_late" });
  });

  it("un codigo que no existe da 404", async () => {
    const db = withBooking();
    expect(await cancelBooking(db.client, { uid: "no-existe", by: "invitee", now: NOW })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("cancelBooking · el anfitrion", () => {
  it("elige el motivo de cancelacion y queda como el usuario que canceló", async () => {
    const db = withBooking();
    const result = await cancelBooking(db.client, { bookingId: "bk-1", by: "host", status: "cancelled_no_response", actorUserId: HOST, now: NOW });
    expect(result.ok).toBe(true);
    const bk = db.rows("bookings")[0];
    expect(bk.status).toBe("cancelled_no_response");
    expect(bk.cancelled_by_user_id).toBe(HOST);
    // No se avisa a sí mismo.
    expect(notifyBooking).toHaveBeenCalledWith(expect.anything(), "bk-1", "booking_cancelled", { actorUserId: HOST });
  });

  it("si puede cancelar una reunion que ya empezo", async () => {
    const db = withBooking();
    const result = await cancelBooking(db.client, { bookingId: "bk-1", by: "host", actorUserId: HOST, now: new Date("2026-10-01T16:05:00.000Z") });
    expect(result.ok).toBe(true);
  });
});

describe("cancelPendingJobs", () => {
  it("anula el fin y los avisos relativos, no la sincronizacion", async () => {
    const db = withBooking();
    db.rows("scheduled_jobs").push(
      { id: "a", type: "booking_ended", payload: { booking_id: "bk-1" }, status: "pending" },
      { id: "b", type: "booking_relative_trigger", payload: { booking_id: "bk-1" }, status: "pending" },
      { id: "c", type: "booking_google_sync", payload: { booking_id: "bk-1" }, status: "pending" },
      { id: "d", type: "booking_ended", payload: { booking_id: "otra" }, status: "pending" },
      { id: "e", type: "booking_ended", payload: { booking_id: "bk-1" }, status: "completed" },
    );
    await cancelPendingJobs(db.client, "bk-1");
    const byId = Object.fromEntries(db.rows("scheduled_jobs").map((j) => [j.id, j.status]));
    expect(byId).toMatchObject({ a: "cancelled", b: "cancelled", c: "pending", d: "pending", e: "completed" });
  });
});

describe("rescheduleBooking", () => {
  it("mueve la misma fila, sube el contador y reprograma los jobs", async () => {
    const db = withBooking();
    db.rows("scheduled_jobs").push({ id: "j1", type: "booking_ended", payload: { booking_id: "bk-1" }, status: "pending", run_at: "2026-10-01T16:30:00.000Z" });

    const nuevo = "2026-10-02T16:00:00.000Z";
    const result = await rescheduleBooking(db.client, { uid: "abcdefghijklmnopqrstuv", startUtc: nuevo, by: "invitee", now: NOW });
    expect(result).toMatchObject({ ok: true, startUtc: nuevo, endUtc: "2026-10-02T16:30:00.000Z" });

    expect(db.rows("bookings")).toHaveLength(1);
    const bk = db.rows("bookings")[0];
    expect(bk.start_at).toBe(nuevo);
    expect(bk.status).toBe("rescheduled");
    expect(bk.reschedule_count).toBe(1);

    const hist = db.rows("audit_log").find((a) => a.action === "booking.rescheduled");
    expect(hist?.changes).toMatchObject({ start_at: { old: START, new: nuevo } });
    const evento = db.rows("automation_events").find((e) => e.event_type === "booking_rescheduled");
    expect(evento?.payload).toMatchObject({ previous_start_at: START, by_whom: "invitee" });

    expect(db.rows("scheduled_jobs").find((j) => j.id === "j1")?.status).toBe("cancelled");
    const nuevos = db.rows("scheduled_jobs").filter((j) => j.status === "pending");
    expect(nuevos.map((j) => j.type).sort()).toEqual(["booking_ended", "booking_google_sync"]);
    expect(nuevos.find((j) => j.type === "booking_google_sync")?.payload).toMatchObject({ action: "update" });
    expect(nuevos.find((j) => j.type === "booking_ended")?.run_at).toBe("2026-10-02T16:30:00.000Z");
    expect(notifyBooking).toHaveBeenCalledWith(expect.anything(), "bk-1", "booking_rescheduled", { actorUserId: null });
  });

  it("si la agenda todavia no llego a Google, manda crear en vez de mover", async () => {
    const db = withBooking({ google_event_id: null });
    await rescheduleBooking(db.client, { uid: "abcdefghijklmnopqrstuv", startUtc: "2026-10-02T16:00:00.000Z", by: "invitee", now: NOW });
    const sync = db.rows("scheduled_jobs").find((j) => j.type === "booking_google_sync");
    expect(sync?.payload).toMatchObject({ action: "create" });
  });

  it("un horario fuera del horario laboral no se acepta", async () => {
    const db = withBooking();
    // Domingo.
    const result = await rescheduleBooking(db.client, { uid: "abcdefghijklmnopqrstuv", startUtc: "2026-10-04T16:00:00.000Z", by: "invitee", now: NOW });
    expect(result).toMatchObject({ ok: false, status: 409, reason: "slot_unavailable" });
    expect(db.rows("bookings")[0].start_at).toBe(START);
  });

  it("el mismo horario se acepta: la propia agenda no se cuenta como ocupada", async () => {
    const db = withBooking();
    const result = await rescheduleBooking(db.client, { uid: "abcdefghijklmnopqrstuv", startUtc: START, by: "invitee", now: NOW });
    expect(result.ok).toBe(true);
  });

  it("el equipo puede mover a un horario que el motor no ofreceria", async () => {
    const db = withBooking();
    const result = await rescheduleBooking(db.client, {
      bookingId: "bk-1",
      startUtc: "2026-10-04T16:00:00.000Z",
      by: "host",
      actorUserId: HOST,
      ignoreAvailability: true,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(db.rows("bookings")[0].start_at).toBe("2026-10-04T16:00:00.000Z");
  });

  it("una agenda cancelada no se reagenda", async () => {
    const db = withBooking({ status: "cancelled_other" });
    const result = await rescheduleBooking(db.client, { uid: "abcdefghijklmnopqrstuv", startUtc: "2026-10-02T16:00:00.000Z", by: "invitee", now: NOW });
    expect(result).toMatchObject({ ok: false, reason: "too_late" });
  });

  it("el invitado no reagenda una reunion que ya empezo", async () => {
    const db = withBooking();
    const result = await rescheduleBooking(db.client, {
      uid: "abcdefghijklmnopqrstuv",
      startUtc: "2026-10-02T16:00:00.000Z",
      by: "invitee",
      now: new Date("2026-10-01T16:05:00.000Z"),
    });
    expect(result).toMatchObject({ ok: false, reason: "too_late" });
  });
});
