import { describe, expect, it } from "vitest";
import { shouldWaitForMeet } from "./meet-wait";

const now = new Date("2026-11-04T12:00:00.000Z");
const createdAt = "2026-11-04T11:59:30.000Z";
const pending = { location_type: "google_meet", meet_url: null, google_sync_status: "pending" };

describe("shouldWaitForMeet", () => {
  it("espera si Google todavia no creo el Meet", () => {
    expect(shouldWaitForMeet({ eventType: "booking_created", createdAt, booking: pending, now })).toBe(true);
  });

  it("no espera si ya esta el link", () => {
    expect(shouldWaitForMeet({ eventType: "booking_created", createdAt, booking: { ...pending, meet_url: "https://meet" }, now })).toBe(false);
  });

  it("no espera sin Meet: una reunion con ubicacion escrita sale igual que siempre", () => {
    expect(shouldWaitForMeet({ eventType: "booking_created", createdAt, booking: { ...pending, location_type: "manual" }, now })).toBe(false);
  });

  it("no espera si el link ya no va a llegar", () => {
    for (const status of ["not_applicable", "failed", "synced"]) {
      expect(shouldWaitForMeet({ eventType: "booking_created", createdAt, booking: { ...pending, google_sync_status: status }, now }), status).toBe(false);
    }
  });

  it("tiene tope: pasados 3 minutos sale sin link, antes que no salir", () => {
    expect(shouldWaitForMeet({ eventType: "booking_created", createdAt: "2026-11-04T11:56:59.000Z", booking: pending, now })).toBe(false);
  });

  it("solo aplica a la reunion recien creada, y un evento sin reunion no espera", () => {
    expect(shouldWaitForMeet({ eventType: "booking_rescheduled", createdAt, booking: pending, now })).toBe(false);
    expect(shouldWaitForMeet({ eventType: "booking_created", createdAt, booking: null, now })).toBe(false);
    expect(shouldWaitForMeet({ eventType: "booking_created", createdAt: null, booking: pending, now })).toBe(false);
  });
});
