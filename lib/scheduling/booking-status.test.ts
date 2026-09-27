import { describe, it, expect } from "vitest";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_KEYS,
  groupOf,
  canTransition,
  evaluateTransition,
  allowedTransitions,
  statusesInGroup,
  isBookingStatus,
  ACTIVE_STATUSES,
} from "./booking-status";

const now = new Date("2026-10-06T16:00:00.000Z");
const futura = { start_at: "2026-10-07T15:00:00.000Z" };
const pasada = { start_at: "2026-10-06T15:00:00.000Z" };

describe("catálogo de estados (F32)", () => {
  it("son los 11 de Wendy, en orden y con grupo", () => {
    expect(BOOKING_STATUS_KEYS).toEqual([
      "scheduled",
      "confirmed",
      "rescheduled",
      "no_show",
      "followup_warm",
      "followup_cold",
      "sale",
      "not_qualified",
      "cancelled_not_qualified",
      "cancelled_no_response",
      "cancelled_other",
    ]);
    expect(BOOKING_STATUSES.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(statusesInGroup("active")).toEqual(["scheduled", "confirmed", "rescheduled"]);
    expect(statusesInGroup("outcome")).toEqual(["followup_warm", "followup_cold", "sale", "not_qualified"]);
    expect(groupOf("no_show")).toBe("no_show");
    expect(groupOf("cancelled_other")).toBe("cancelled");
    expect(ACTIVE_STATUSES).toHaveLength(3);
    expect(isBookingStatus("sale")).toBe(true);
    expect(isBookingStatus("pending")).toBe(false);
  });
});

describe("canTransition (F32)", () => {
  it("pasar a Venta una agenda que todavía no empezó: false", () => {
    expect(canTransition("scheduled", "sale", futura, now)).toBe(false);
    expect(evaluateTransition("scheduled", "sale", futura, now).reason).toBe("not_started_yet");
    expect(canTransition("scheduled", "no_show", futura, now)).toBe(false);
  });

  it("de cancelada a confirmada: false (cancelled es final)", () => {
    expect(canTransition("cancelled_other", "confirmed", pasada, now)).toBe(false);
    expect(evaluateTransition("cancelled_other", "scheduled", futura, now).reason).toBe("cancelled_is_final");
  });

  it("de no_show a sale: permitido", () => {
    expect(canTransition("no_show", "sale", pasada, now)).toBe(true);
  });

  it("active → active o cancelled en cualquier momento; active → resultado solo después del inicio", () => {
    expect(canTransition("scheduled", "confirmed", futura, now)).toBe(true);
    expect(canTransition("confirmed", "cancelled_no_response", futura, now)).toBe(true);
    expect(canTransition("rescheduled", "sale", pasada, now)).toBe(true);
    expect(canTransition("scheduled", "followup_warm", pasada, now)).toBe(true);
  });

  it("correcciones: outcome ↔ outcome, outcome ↔ no_show, y volver a confirmed", () => {
    expect(canTransition("sale", "not_qualified", pasada, now)).toBe(true);
    expect(canTransition("sale", "no_show", pasada, now)).toBe(true);
    expect(canTransition("no_show", "confirmed", pasada, now)).toBe(true);
    expect(canTransition("followup_cold", "confirmed", pasada, now)).toBe(true);
    // Pero no a scheduled ni rescheduled.
    expect(canTransition("no_show", "scheduled", pasada, now)).toBe(false);
    expect(canTransition("sale", "rescheduled", pasada, now)).toBe(false);
    // Y sí se puede cancelar un resultado.
    expect(canTransition("no_show", "cancelled_other", pasada, now)).toBe(true);
  });

  it("al mismo estado no es una transición", () => {
    expect(evaluateTransition("scheduled", "scheduled", futura, now)).toEqual({ ok: false, reason: "same_status" });
  });

  it("allowedTransitions devuelve el menú del chip en el orden del catálogo", () => {
    expect(allowedTransitions({ status: "scheduled", ...futura }, now)).toEqual([
      "confirmed",
      "rescheduled",
      "cancelled_not_qualified",
      "cancelled_no_response",
      "cancelled_other",
    ]);
    expect(allowedTransitions({ status: "cancelled_other", ...pasada }, now)).toEqual([]);
  });
});
