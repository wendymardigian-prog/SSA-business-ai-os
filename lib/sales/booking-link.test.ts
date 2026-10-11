import { describe, expect, it } from "vitest";
import { bookingBelongsToSale, canLoadSaleFromBooking, eligibleBookings, prefillFromBooking, saleHasEventType } from "./booking-link";

const now = new Date("2026-10-11T12:00:00Z");
const b = (id: string, contact: string | null, start: string, status = "sale", host: string | null = "h1") => ({ id, contact_id: contact, start_at: start, status, host_user_id: host, event_type_id: "et1" });

describe("eligibleBookings", () => {
  const all = [b("a", "c1", "2026-10-01T10:00:00Z"), b("b", "c1", "2026-10-05T10:00:00Z"), b("c", "c2", "2026-10-03T10:00:00Z"), b("d", "c1", "2031-01-01T10:00:00Z")];
  it("solo las pasadas del contacto, de la más nueva a la más vieja", () => {
    expect(eligibleBookings(all, "c1", now).map((x) => x.id)).toEqual(["b", "a"]);
    expect(eligibleBookings(all, null, now)).toEqual([]);
  });
});

describe("bookingBelongsToSale (lo que valida el servidor)", () => {
  it("una agenda de otro contacto se rechaza, y una futura también", () => {
    expect(bookingBelongsToSale(b("a", "c2", "2026-10-01T10:00:00Z"), "c1", now)).toBe(false);
    expect(bookingBelongsToSale(b("a", "c1", "2031-10-01T10:00:00Z"), "c1", now)).toBe(false);
    expect(bookingBelongsToSale(b("a", "c1", "2026-10-01T10:00:00Z"), "c1", now)).toBe(true);
    expect(bookingBelongsToSale(null, "c1", now)).toBe(false);
  });
});

describe("canLoadSaleFromBooking", () => {
  it("solo con un resultado y ya ocurrida: ni agendada, ni cancelada, ni futura", () => {
    expect(canLoadSaleFromBooking(b("a", "c1", "2026-10-01T10:00:00Z", "followup_warm"), now)).toBe(true);
    expect(canLoadSaleFromBooking(b("a", "c1", "2026-10-01T10:00:00Z", "scheduled"), now)).toBe(false);
    expect(canLoadSaleFromBooking(b("a", "c1", "2026-10-01T10:00:00Z", "cancelled_other"), now)).toBe(false);
    expect(canLoadSaleFromBooking(b("a", "c1", "2031-10-01T10:00:00Z", "sale"), now)).toBe(false);
    expect(canLoadSaleFromBooking(b("a", null, "2026-10-01T10:00:00Z", "sale"), now)).toBe(false);
  });
});

describe("prefillFromBooking", () => {
  it("el contacto y la agenda vienen resueltos; el anfitrión del equipo queda de vendedor", () => {
    expect(prefillFromBooking(b("a", "c1", "2026-10-01T10:00:00Z"), new Set(["h1"]))).toEqual({ contactId: "c1", bookingId: "a", vendedorId: "h1" });
    expect(prefillFromBooking(b("a", "c1", "2026-10-01T10:00:00Z", "sale", "ajeno"), new Set(["h1"]))?.vendedorId).toBeNull();
    expect(prefillFromBooking(b("a", null, "2026-10-01T10:00:00Z"), new Set())).toBeNull();
  });
});

describe("saleHasEventType (condición de flujo)", () => {
  const map = new Map([["a", { event_type_id: "et1" }], ["b", { event_type_id: "et2" }]]);
  it("true solo para ventas con agenda de ese tipo", () => {
    expect(saleHasEventType({ booking_id: "a" }, map, "et1")).toBe(true);
    expect(saleHasEventType({ booking_id: "b" }, map, "et1")).toBe(false);
    expect(saleHasEventType({ booking_id: null }, map, "et1")).toBe(false);
  });
});
