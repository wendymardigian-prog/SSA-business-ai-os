import { describe, expect, it } from "vitest";
import { isOverdue, overdueCutoff, shouldEnqueueSweep, sweepDedupeKey } from "./overdue";

const pay = (due: string | null, status = "scheduled") => ({ status, due_date: due });

describe("isOverdue", () => {
  it("con gracia 0, vence hoy no pasa y vencido ayer sí", () => {
    expect(isOverdue(pay("2026-10-26"), "2026-10-26", 0)).toBe(false);
    expect(isOverdue(pay("2026-10-25"), "2026-10-26", 0)).toBe(true);
  });
  it("con gracia 3, el de hace 3 días no y el de hace 4 sí", () => {
    expect(isOverdue(pay("2026-10-23"), "2026-10-26", 3)).toBe(false);
    expect(isOverdue(pay("2026-10-22"), "2026-10-26", 3)).toBe(true);
    expect(overdueCutoff("2026-10-26", 3)).toBe("2026-10-23");
  });
  it("solo toca lo programado: lo cobrado, anulado o incobrable no pasa", () => {
    for (const status of ["paid", "cancelled", "uncollectible", "overdue", "refunded"]) expect(isOverdue(pay("2020-01-01", status), "2026-10-26", 0)).toBe(false);
    expect(isOverdue(pay(null), "2026-10-26", 0)).toBe(false);
  });
});

describe("shouldEnqueueSweep (espejo de la función SQL)", () => {
  const tz = "America/Costa_Rica";
  it("antes de las 03:00 locales no encola; a las 03:07 sí", () => {
    expect(shouldEnqueueSweep(new Date("2026-10-27T06:30:00Z"), tz)).toBe(false); // 00:30 CR
    expect(shouldEnqueueSweep(new Date("2026-10-27T08:59:00Z"), tz)).toBe(false); // 02:59 CR
    expect(shouldEnqueueSweep(new Date("2026-10-27T09:07:00Z"), tz)).toBe(true); // 03:07 CR
  });
  it("la zona manda, no UTC", () => {
    expect(shouldEnqueueSweep(new Date("2026-10-27T09:07:00Z"), "UTC")).toBe(true);
    expect(shouldEnqueueSweep(new Date("2026-10-27T02:00:00Z"), "UTC")).toBe(false);
  });
  it("la clave del job lleva el workspace y la fecha local", () => {
    expect(sweepDedupeKey("ws-1", "2026-10-27")).toBe("overdue:ws-1:2026-10-27");
  });
});
