import { describe, expect, it } from "vitest";
import { daysInMonthOf, mondayOf, rangeFor, shiftAnchor } from "./calendar-range";

describe("mondayOf", () => {
  it("un jueves vuelve al lunes de esa semana", () => {
    // 2026-10-01 es jueves.
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
  });
  it("un lunes se queda donde está", () => {
    expect(mondayOf("2026-09-28")).toBe("2026-09-28");
  });
  it("un domingo vuelve seis días atrás, no uno", () => {
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
  });
});

describe("daysInMonthOf", () => {
  it("cuenta bien los meses cortos y febrero", () => {
    expect(daysInMonthOf("2026-09-15")).toBe(30);
    expect(daysInMonthOf("2026-10-15")).toBe(31);
    expect(daysInMonthOf("2026-02-15")).toBe(28);
    expect(daysInMonthOf("2028-02-15")).toBe(29);
  });
});

describe("rangeFor", () => {
  it("el día es un solo día", () => {
    expect(rangeFor("day", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("la semana va de lunes a domingo", () => {
    expect(rangeFor("week", "2026-10-01")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("el mes empieza el lunes anterior al día 1 y termina el domingo posterior al último", () => {
    // Octubre de 2026 arranca jueves y termina sábado.
    expect(rangeFor("month", "2026-10-15")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
  });

  it("un mes que arranca lunes no agrega días de relleno al principio", () => {
    // Junio de 2026 arranca lunes.
    expect(rangeFor("month", "2026-06-10").from).toBe("2026-06-01");
  });
});

describe("shiftAnchor", () => {
  it("el día se mueve de a uno", () => {
    expect(shiftAnchor("day", "2026-10-01", 1)).toBe("2026-10-02");
    expect(shiftAnchor("day", "2026-10-01", -1)).toBe("2026-09-30");
  });
  it("la semana se mueve de a siete", () => {
    expect(shiftAnchor("week", "2026-10-01", 1)).toBe("2026-10-08");
  });
  it("el mes cae en el día 1 del mes de al lado", () => {
    expect(shiftAnchor("month", "2026-10-15", 1)).toBe("2026-11-01");
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01");
  });
});
