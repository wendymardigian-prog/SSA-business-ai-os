import { describe, expect, it } from "vitest";
import { dateBounds, describeDateValue, parseDateValue, PAST_PRESETS } from "./dates";

const TZ = "America/Costa_Rica"; // UTC-6, sin horario de verano
const NOW = new Date("2026-11-03T15:00:00Z"); // 3/11 a las 9:00 en Costa Rica

describe("leer el valor de la URL", () => {
  it("un atajo vale solo si el filtro lo ofrece", () => {
    expect(parseDateValue("7d", PAST_PRESETS)).toEqual({ preset: "7d" });
    expect(parseDateValue("vencido", PAST_PRESETS)).toBeNull();
  });

  it("un rango con una o dos puntas; al revés se da vuelta", () => {
    expect(parseDateValue("2026-10-01..2026-10-31", [])).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(parseDateValue("2026-10-01..", [])).toEqual({ from: "2026-10-01", to: null });
    expect(parseDateValue("..2026-10-31", [])).toEqual({ from: null, to: "2026-10-31" });
    expect(parseDateValue("2026-10-31..2026-10-01", [])).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("lo inventado no vale", () => {
    for (const raw of ["..", "ayer..hoy", "2026-02-31..", "2026-1-1..", "2026-10-01", "'; drop"]) {
      expect(parseDateValue(raw, PAST_PRESETS)).toBeNull();
    }
  });

  it("el texto del chip", () => {
    expect(describeDateValue("30d", PAST_PRESETS)).toBe("Últimos 30 días");
    expect(describeDateValue("2026-10-01..2026-10-31", [])).toBe("01/10/2026 – 31/10/2026");
    expect(describeDateValue("2026-10-01..", [])).toBe("Desde el 01/10/2026");
  });
});

describe("el rango en la zona de quien mira", () => {
  it("hoy va de la medianoche a la medianoche de Costa Rica", () => {
    expect(dateBounds({ preset: "hoy" }, NOW, TZ)).toEqual({ gte: "2026-11-03T06:00:00.000Z", lte: "2026-11-04T05:59:59.999Z" });
  });

  it("los últimos 7 días incluyen hoy y no tienen techo", () => {
    expect(dateBounds({ preset: "7d" }, NOW, TZ)).toEqual({ gte: "2026-10-28T06:00:00.000Z" });
  });

  it("vencido es antes de hoy; sin fecha es vacío", () => {
    expect(dateBounds({ preset: "vencido" }, NOW, TZ)).toEqual({ lt: "2026-11-03T06:00:00.000Z" });
    expect(dateBounds({ preset: "sin" }, NOW, TZ)).toEqual({ isNull: true });
  });

  it("próximas y pasadas se cortan en este instante", () => {
    expect(dateBounds({ preset: "proximas" }, NOW, TZ)).toEqual({ gte: NOW.toISOString() });
    expect(dateBounds({ preset: "pasadas" }, NOW, TZ)).toEqual({ lt: NOW.toISOString() });
  });

  it("un rango toma los días enteros", () => {
    expect(dateBounds({ from: "2026-10-01", to: "2026-10-01" }, NOW, TZ)).toEqual({
      gte: "2026-10-01T06:00:00.000Z",
      lte: "2026-10-02T05:59:59.999Z",
    });
  });
});
