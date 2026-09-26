import { describe, it, expect } from "vitest";
import {
  validateWeeklyHours,
  parseWeeklyHours,
  findOverlap,
  defaultWeeklyHours,
  timeRangeSchema,
} from "./availability-schema";

describe("validateWeeklyHours (F11)", () => {
  it("acepta el horario normal de lunes a viernes", () => {
    expect(validateWeeklyHours(defaultWeeklyHours())).toEqual({ ok: true });
  });

  it("rechaza un rango que termina antes de empezar, marcando el día", () => {
    const r = validateWeeklyHours({ "1": [{ start: "12:00", end: "09:00" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].day).toBe("1");
      expect(r.errors[0].message).toMatch(/posterior/);
    }
  });

  it("rechaza dos rangos superpuestos del mismo día, con el día marcado", () => {
    const r = validateWeeklyHours({
      "2": [
        { start: "09:00", end: "12:00" },
        { start: "11:30", end: "14:00" },
      ],
      "3": [{ start: "09:00", end: "12:00" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].day).toBe("2");
      expect(r.errors[0].message).toMatch(/superponen/);
    }
  });

  it("rangos que se tocan no se superponen", () => {
    expect(
      findOverlap([
        { start: "14:00", end: "18:00" },
        { start: "09:00", end: "14:00" },
      ]),
    ).toBeNull();
  });

  it("un fin 00:00 se interpreta como 24:00 (fin del día)", () => {
    const parsed = parseWeeklyHours({ "5": [{ start: "20:00", end: "00:00" }] });
    expect(parsed).toEqual({ "5": [{ start: "20:00", end: "24:00" }] });
    expect(timeRangeSchema.safeParse({ start: "00:00", end: "00:00" }).success).toBe(true);
  });

  it("rechaza horas mal formadas y días inválidos", () => {
    expect(validateWeeklyHours({ "1": [{ start: "9:00", end: "17:00" }] }).ok).toBe(false);
    expect(validateWeeklyHours({ "7": [{ start: "09:00", end: "17:00" }] }).ok).toBe(false);
    expect(validateWeeklyHours({ "1": [{ start: "09:00", end: "24:30" }] }).ok).toBe(false);
    expect(validateWeeklyHours([]).ok).toBe(false);
    expect(validateWeeklyHours(null).ok).toBe(false);
  });

  it("un día ausente o vacío es válido (no trabaja)", () => {
    expect(validateWeeklyHours({ "0": [], "6": [] })).toEqual({ ok: true });
    expect(validateWeeklyHours({})).toEqual({ ok: true });
  });
});
