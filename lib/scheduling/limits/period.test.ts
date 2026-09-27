import { describe, it, expect } from "vitest";
import { periodBounds, isOutOfBounds, addBusinessDays } from "./period";

const CR = "America/Costa_Rica";
// Martes 6/10/2026 10:10 en Costa Rica.
const now = new Date("2026-10-06T16:10:00.000Z");

describe("periodBounds (F21)", () => {
  it("N días corridos incluye el día N completo", () => {
    const b = periodBounds({ periodType: "rolling_calendar", periodDays: 2 }, now, CR);
    expect(b.fromUtc).toBeNull();
    expect(b.toUtc?.toISOString()).toBe("2026-10-09T06:00:00.000Z"); // 00:00 del 9/10 (día 8 completo)
  });

  it("N días hábiles salta el fin de semana", () => {
    // Martes + 4 hábiles = lunes 12/10; permitido hasta el 13/10 00:00.
    const b = periodBounds({ periodType: "rolling_business", periodDays: 4 }, now, CR);
    expect(b.toUtc?.toISOString()).toBe("2026-10-13T06:00:00.000Z");
    expect(addBusinessDays("2026-10-09", 1)).toBe("2026-10-12"); // viernes + 1 = lunes
  });

  it("entre fechas cubre los dos días completos en la zona", () => {
    const b = periodBounds(
      { periodType: "range", periodStartDate: "2026-11-01", periodEndDate: "2026-11-15" },
      now,
      CR,
    );
    expect(b.fromUtc?.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(b.toUtc?.toISOString()).toBe("2026-11-16T06:00:00.000Z");
  });

  it("sin límite no tiene topes", () => {
    expect(periodBounds({ periodType: "unlimited" }, now, CR)).toEqual({ fromUtc: null, toUtc: null });
  });
});

describe("isOutOfBounds", () => {
  const cfg = { periodType: "rolling_calendar" as const, periodDays: 60, minimumNoticeMinutes: 120 };

  it("un horario pasado", () => {
    expect(isOutOfBounds("2026-10-06T15:00:00.000Z", cfg, now, CR)).toEqual({ out: true, reason: "past" });
  });

  it("dentro del aviso mínimo de 2 h: 12:00 local no, 12:30 local sí (criterio F23)", () => {
    expect(isOutOfBounds("2026-10-06T18:00:00.000Z", cfg, now, CR).reason).toBe("minimum_notice");
    expect(isOutOfBounds("2026-10-06T18:30:00.000Z", cfg, now, CR)).toEqual({ out: false, reason: null });
  });

  it("después de la ventana", () => {
    expect(isOutOfBounds("2026-12-10T15:00:00.000Z", cfg, now, CR).reason).toBe("after_window");
    expect(isOutOfBounds("2026-12-05T15:00:00.000Z", cfg, now, CR).out).toBe(false);
  });

  it("antes del inicio de un rango", () => {
    const r = isOutOfBounds(
      "2026-10-20T15:00:00.000Z",
      { periodType: "range", periodStartDate: "2026-11-01", periodEndDate: "2026-11-15" },
      now,
      CR,
    );
    expect(r.reason).toBe("before_range");
  });
});
