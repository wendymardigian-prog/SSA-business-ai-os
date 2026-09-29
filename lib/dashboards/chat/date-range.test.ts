import { describe, expect, it } from "vitest";
import {
  addDays, civilRangeToIso, compareCivil, formatCivil, formatMonth, formatRange, fromKey,
  isoRangeToCivil, mondayOfCivil, monthGrid, nextMonth, periodButtonLabel, pickDay, previousMonth,
  sameCivil, toKey, todayIn,
} from "./date-range";

const TZ = "America/Costa_Rica"; // sin horario de verano, -06:00 todo el año
const TODAY = { year: 2026, month: 9, day: 25 };

describe("toKey / fromKey", () => {
  it("van y vuelven", () => {
    expect(toKey({ year: 2026, month: 9, day: 5 })).toBe("2026-09-05");
    expect(fromKey("2026-09-05")).toEqual({ year: 2026, month: 9, day: 5 });
  });

  it("rechaza lo que no es una fecha", () => {
    expect(fromKey("2026-9-5")).toBeNull();
    expect(fromKey("hola")).toBeNull();
    expect(fromKey("2026-13-01")).toBeNull();
    // El 31 de febrero no existe y no se acepta "corregido" al 3 de marzo.
    expect(fromKey("2026-02-31")).toBeNull();
  });
});

describe("addDays", () => {
  it("cruza el fin de mes y de año", () => {
    expect(addDays({ year: 2026, month: 9, day: 30 }, 1)).toEqual({ year: 2026, month: 10, day: 1 });
    expect(addDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({ year: 2025, month: 12, day: 31 });
  });
});

describe("mondayOfCivil", () => {
  it("un domingo cae en el lunes anterior", () => {
    expect(mondayOfCivil({ year: 2026, month: 9, day: 27 })).toEqual({ year: 2026, month: 9, day: 21 });
  });
  it("un lunes es su propio lunes", () => {
    expect(mondayOfCivil({ year: 2026, month: 9, day: 21 })).toEqual({ year: 2026, month: 9, day: 21 });
  });
});

describe("monthGrid", () => {
  const grid = monthGrid(2026, 9, TODAY);

  it("son seis semanas completas y arranca un lunes", () => {
    expect(grid).toHaveLength(42);
    expect(grid[0].date).toEqual({ year: 2026, month: 8, day: 31 });
    expect(grid[0].inMonth).toBe(false);
  });

  it("marca el mes, hoy y el futuro", () => {
    const hoy = grid.find((c) => c.key === "2026-09-25");
    expect(hoy).toMatchObject({ inMonth: true, isToday: true, isFuture: false });
    const manana = grid.find((c) => c.key === "2026-09-26");
    expect(manana?.isFuture).toBe(true);
  });

  it("el mes anterior y el siguiente cruzan el año", () => {
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
    expect(nextMonth(2026, 12)).toEqual({ year: 2027, month: 1 });
  });
});

describe("pickDay", () => {
  const a = { year: 2026, month: 9, day: 10 };
  const b = { year: 2026, month: 9, day: 20 };

  it("el primer clic abre el rango", () => {
    expect(pickDay(null, a)).toEqual({ from: a, to: null });
  });

  it("el segundo clic lo cierra", () => {
    expect(pickDay({ from: a, to: null }, b)).toEqual({ from: a, to: b });
  });

  it("elegido al reves, se da vuelta", () => {
    expect(pickDay({ from: b, to: null }, a)).toEqual({ from: a, to: b });
  });

  it("con un rango completo, empieza otro", () => {
    expect(pickDay({ from: a, to: b }, { year: 2026, month: 9, day: 25 })).toEqual({
      from: { year: 2026, month: 9, day: 25 },
      to: null,
    });
  });
});

describe("civilRangeToIso", () => {
  it("toma el principio y el FIN del dia, en la zona del negocio", () => {
    const iso = civilRangeToIso({ from: { year: 2026, month: 9, day: 1 }, to: { year: 2026, month: 9, day: 25 } }, TZ);
    // Costa Rica es -06:00: las 00:00 locales son las 06:00 UTC.
    expect(iso.from).toBe("2026-09-01T06:00:00.000Z");
    expect(iso.to).toBe("2026-09-26T05:59:59.999Z");
  });

  it("da vuelta un rango invertido antes de convertirlo", () => {
    const iso = civilRangeToIso({ from: { year: 2026, month: 9, day: 25 }, to: { year: 2026, month: 9, day: 1 } }, TZ);
    expect(iso.from).toBe("2026-09-01T06:00:00.000Z");
  });

  it("ida y vuelta: lo que se escribe en la URL se lee igual", () => {
    const original = { from: { year: 2026, month: 3, day: 2 }, to: { year: 2026, month: 9, day: 25 } };
    const iso = civilRangeToIso(original, TZ);
    expect(isoRangeToCivil(iso.from, iso.to, TZ)).toEqual(original);
  });
});

describe("isoRangeToCivil", () => {
  it("sin rango o con basura, null", () => {
    expect(isoRangeToCivil(null, null, TZ)).toBeNull();
    expect(isoRangeToCivil("no-es-fecha", "tampoco", TZ)).toBeNull();
    expect(isoRangeToCivil("2026-09-01T06:00:00.000Z", null, TZ)).toBeNull();
  });
});

describe("formatos", () => {
  it("una fecha se lee en castellano", () => {
    expect(formatCivil({ year: 2026, month: 9, day: 5 })).toBe("05 sept 2026");
    expect(formatMonth(2026, 9)).toBe("Septiembre 2026");
  });

  it("el rango dice cuando falta el fin", () => {
    expect(formatRange({ from: { year: 2026, month: 9, day: 1 }, to: null })).toContain("elegí el fin");
    expect(formatRange(null)).toBe("Elegí un día");
  });

  it("el boton muestra el atajo si hay atajo", () => {
    expect(periodButtonLabel("Este mes", null)).toBe("Este mes");
    expect(periodButtonLabel(null, { from: { year: 2026, month: 9, day: 1 }, to: { year: 2026, month: 9, day: 25 } })).toBe("1 sept – 25 sept");
    expect(periodButtonLabel(null, { from: TODAY, to: TODAY })).toBe("25 sept");
  });
});

describe("todayIn / compareCivil / sameCivil", () => {
  it("hoy sale de la zona del negocio, no del navegador", () => {
    // 04:00 UTC del 26 todavia es el 25 en Costa Rica (-06:00).
    expect(todayIn(TZ, new Date("2026-09-26T04:00:00.000Z"))).toEqual(TODAY);
  });

  it("compara y compara igualdad", () => {
    expect(compareCivil({ year: 2026, month: 9, day: 1 }, { year: 2026, month: 10, day: 1 })).toBeLessThan(0);
    expect(sameCivil(TODAY, { ...TODAY })).toBe(true);
    expect(sameCivil(TODAY, null)).toBe(false);
  });
});
