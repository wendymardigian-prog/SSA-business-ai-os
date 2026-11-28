// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { addDaysIso, calendarWindows, classTimeLabel, hasEnded, isLiveNow, pastOnly, upcomingOnly } from "./occurrence-time";

// La clase del viernes 27/11 a las 19:00 de Costa Rica (01:00 UTC del sábado), de una hora.
const tonight = { id: "hoy", starts_at: "2026-11-28T01:00:00Z", ends_at: "2026-11-28T02:00:00Z" };
const monday = { id: "lunes", starts_at: "2026-12-01T01:00:00Z", ends_at: "2026-12-01T02:00:00Z" };
const lastWeek = { id: "antes", starts_at: "2026-11-21T01:00:00Z", ends_at: "2026-11-21T02:00:00Z" };

describe("próximas y pasadas por hora", () => {
  it("a las 18:06 de Costa Rica (ya es sábado en UTC) la clase de esta noche sigue en Próximas", () => {
    const now = Date.parse("2026-11-28T00:06:00Z");
    expect(upcomingOnly([monday, tonight, lastWeek], now).map((o) => o.id)).toEqual(["hoy", "lunes"]);
    expect(pastOnly([tonight, lastWeek], now).map((o) => o.id)).toEqual(["antes"]);
  });

  it("en curso: está en Próximas con la marca, no en Pasadas", () => {
    const now = Date.parse("2026-11-28T01:30:00Z");
    expect(isLiveNow(tonight, now)).toBe(true);
    expect(upcomingOnly([tonight], now)).toHaveLength(1);
    expect(pastOnly([tonight], now)).toHaveLength(0);
  });

  it("al terminar pasa a Pasadas", () => {
    const now = Date.parse("2026-11-28T02:00:00Z");
    expect(hasEnded(tonight, now)).toBe(true);
    expect(upcomingOnly([tonight], now)).toHaveLength(0);
    expect(pastOnly([tonight], now)).toHaveLength(1);
  });
});

describe("rangos con el día del negocio", () => {
  it("cuenta desde el día del negocio, con un día de margen", () => {
    const w = calendarWindows(new Date("2026-11-28T00:06:00Z"), "America/Costa_Rica");
    expect(w.today).toBe("2026-11-27");
    expect(w.upcomingFrom).toBe("2026-11-26");
    expect(w.pastTo).toBe("2026-11-28");
    expect(w.pastFrom).toBe("2026-08-29");
  });

  it("una zona inválida cae a UTC sin romper", () => {
    expect(calendarWindows(new Date("2026-11-28T00:06:00Z"), "No/Existe").today).toBe("2026-11-28");
  });

  it("suma días cruzando meses", () => {
    expect(addDaysIso("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("hora con su zona", () => {
  it("muestra la hora de quien mira con el nombre de su zona", () => {
    expect(classTimeLabel(tonight.starts_at, "America/Costa_Rica")).toBe("19:00 (Costa Rica)");
    expect(classTimeLabel(tonight.starts_at, "America/Argentina/Buenos_Aires")).toBe("22:00 (Buenos Aires)");
  });
});
