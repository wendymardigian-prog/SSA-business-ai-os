import { describe, it, expect } from "vitest";
import { addDays, conversionRate, formatPercent, resolvePeriod, startRate, summarize } from "./metrics";

describe("tasas", () => {
  it("conversionRate(3, 0) da null y conversionRate(3, 12) da 0.25", () => {
    expect(conversionRate(3, 0)).toBeNull();
    expect(conversionRate(3, 12)).toBe(0.25);
  });

  it("startRate con cero vistas es null", () => {
    expect(startRate(2, 0)).toBeNull();
    expect(startRate(6, 12)).toBe(0.5);
  });

  it("formatPercent muestra — si no hay tasa", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0.25)).toBe("25,0 %");
  });
});

describe("summarize", () => {
  it("suma los días", () => {
    const s = summarize([
      { day: "2026-10-09", views: 10, starts: 6, submissions: 2, spam: 0, rejected: 1 },
      { day: "2026-10-10", views: 2, starts: 2, submissions: 1, spam: 1, rejected: 0 },
    ]);
    expect(s).toMatchObject({ views: 12, starts: 8, submissions: 3, spam: 1, rejected: 1 });
    expect(s.conversion).toBe(0.25);
  });

  it("sin filas todo en cero y sin tasas", () => {
    expect(summarize([])).toEqual({ views: 0, starts: 0, submissions: 0, spam: 0, rejected: 0, conversion: null, startRate: null });
  });
});

describe("resolvePeriod", () => {
  const today = "2026-10-10";

  it("por defecto, los últimos 30 días incluyendo hoy", () => {
    expect(resolvePeriod({}, today)).toEqual({ from: "2026-09-11", to: "2026-10-10" });
  });

  it("7 y 90 días", () => {
    expect(resolvePeriod({ dias: "7" }, today).from).toBe("2026-10-04");
    expect(resolvePeriod({ dias: "90" }, today).from).toBe("2026-07-13");
  });

  it("personalizado: se ordena, no pasa de hoy y se acota a 366 días", () => {
    expect(resolvePeriod({ desde: "2026-10-05", hasta: "2026-10-01" }, today)).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    expect(resolvePeriod({ desde: "2026-10-01", hasta: "2027-01-01" }, today).to).toBe(today);
    const long = resolvePeriod({ desde: "2020-01-01", hasta: "2026-10-10" }, today);
    expect(long.to).toBe(today);
    expect(long.from).toBe(addDays(today, -365));
  });

  it("un valor inválido cae al período por defecto", () => {
    expect(resolvePeriod({ dias: "999", desde: "x", hasta: "y" }, today)).toEqual({ from: "2026-09-11", to: today });
  });
});

import { vi, afterEach } from "vitest";
import { dayInZone } from "./metrics";

describe("dayInZone", () => {
  afterEach(() => vi.useRealTimers());

  it("un envío a las 23:30 de Costa Rica cuenta en ese día y no en el siguiente de UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T05:30:00Z")); // 23:30 del 10/10 en Costa Rica (UTC-6)
    expect(dayInZone(new Date(), "America/Costa_Rica")).toBe("2026-10-10");
    expect(dayInZone(new Date(), "UTC")).toBe("2026-10-11");
  });

  it("acepta un instante en texto", () => {
    expect(dayInZone("2026-10-11T05:30:00Z", "America/Costa_Rica")).toBe("2026-10-10");
  });
});
