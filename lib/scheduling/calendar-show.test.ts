import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR_STATUSES, parseMeetingsShown, showsCancelled, statusParams, visibleCalendarStatuses } from "./calendar-show";

describe("«Qué mostrar»: estados de las reuniones", () => {
  it("sin elegir, todo menos las canceladas", () => {
    expect(visibleCalendarStatuses([])).toEqual(DEFAULT_CALENDAR_STATUSES);
    expect(DEFAULT_CALENDAR_STATUSES.some((s) => s.startsWith("cancelled"))).toBe(false);
  });

  it("las canceladas se dibujan solo si se eligió alguna", () => {
    expect(showsCancelled([])).toBe(false);
    expect(showsCancelled(["scheduled", "cancelled_other"])).toBe(true);
  });

  it("volver a lo de siempre borra el parámetro; vaciar oculta las reuniones", () => {
    expect(statusParams(DEFAULT_CALENDAR_STATUSES)).toEqual({ estado: null, reuniones: null });
    expect(statusParams([])).toEqual({ estado: null, reuniones: "0" });
    expect(statusParams(["sale", "scheduled"])).toEqual({ estado: ["scheduled", "sale"], reuniones: null });
  });

  it("reuniones=0 las oculta", () => {
    expect(parseMeetingsShown(undefined)).toBe(true);
    expect(parseMeetingsShown("0")).toBe(false);
  });
});
