/**
 * La cuota de Resend (F66).
 */

import { describe, it, expect } from "vitest";
import { computeQuota, DEFAULT_DAILY_QUOTA, shouldNotify } from "./quota";

describe("la cuota de hoy (F66)", () => {
  it("cuenta entrada y salida: el plan de Resend cuenta las dos", () => {
    const usage = computeQuota({ sentToday: 30, receivedToday: 20 });

    expect(usage).toMatchObject({ used: 50, quota: DEFAULT_DAILY_QUOTA, percent: 50, remaining: 50 });
  });

  it("al 90% hay que avisar", () => {
    expect(computeQuota({ sentToday: 90, receivedToday: 0 }).shouldWarn).toBe(true);
    expect(computeQuota({ sentToday: 80, receivedToday: 0 }).shouldWarn).toBe(false);
  });

  it("agotada, lo dice con todas las letras", () => {
    // Sin aviso, nadie se entera hasta que un cliente pregunta por que no
    // le contestaron.
    const usage = computeQuota({ sentToday: 100, receivedToday: 5 });

    expect(usage.exhausted).toBe(true);
    expect(usage.label).toContain("no van a salir hasta mañana");
  });

  it("una cuota configurada manda sobre la del plan gratis", () => {
    expect(computeQuota({ sentToday: 150, receivedToday: 0, quota: 1000 }).percent).toBe(15);
  });

  it("una cuota invalida cae a la del plan gratis", () => {
    expect(computeQuota({ sentToday: 1, receivedToday: 0, quota: 0 }).quota).toBe(DEFAULT_DAILY_QUOTA);
  });
});

describe("cuando avisar (F66)", () => {
  const usage = computeQuota({ sentToday: 95, receivedToday: 0 });

  it("la primera vez del dia, si", () => {
    expect(shouldNotify({ usage, lastNotifiedAt: null, today: "2026-10-01" })).toBe(true);
  });

  it("dos veces el mismo dia, no", () => {
    // Diez avisos del mismo problema hacen que se ignoren todos.
    expect(
      shouldNotify({ usage, lastNotifiedAt: "2026-10-01T08:00:00Z", today: "2026-10-01" }),
    ).toBe(false);
  });

  it("al dia siguiente, otra vez", () => {
    expect(
      shouldNotify({ usage, lastNotifiedAt: "2026-09-30T08:00:00Z", today: "2026-10-01" }),
    ).toBe(true);
  });

  it("debajo del umbral, nunca", () => {
    expect(
      shouldNotify({
        usage: computeQuota({ sentToday: 10, receivedToday: 0 }),
        lastNotifiedAt: null,
        today: "2026-10-01",
      }),
    ).toBe(false);
  });
});
