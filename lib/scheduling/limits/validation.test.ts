import { describe, it, expect } from "vitest";
import { validateLimits } from "./validation";

const CR = "America/Costa_Rica";
const now = new Date("2026-10-06T16:10:00.000Z");

const base = {
  before_buffer_minutes: 0,
  after_buffer_minutes: 15,
  minimum_notice_minutes: 120,
  slot_interval_minutes: null,
  max_per_day: null,
  max_per_week: null,
  period_type: "rolling_calendar" as const,
  period_days: 60,
};

describe("validateLimits (F21)", () => {
  it("acepta la configuración por defecto sin advertencias", () => {
    expect(validateLimits(base, now, CR)).toEqual({ ok: true, warnings: [] });
  });

  it("rechaza 'Entre fechas' con fin anterior al inicio", () => {
    const r = validateLimits(
      { ...base, period_type: "range", period_start_date: "2026-11-15", period_end_date: "2026-11-01" },
      now,
      CR,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toEqual({ path: "period_end_date", message: "El fin tiene que ser posterior al inicio" });
  });

  it("advierte cuando el aviso mínimo supera la ventana futura", () => {
    const r = validateLimits({ ...base, minimum_notice_minutes: 3 * 1440, period_days: 2 }, now, CR);
    expect(r).toEqual({ ok: true, warnings: ["no_slots_possible"] });
  });

  it("advierte también con un rango que ya queda detrás del aviso", () => {
    const r = validateLimits(
      { ...base, period_type: "range", period_start_date: "2026-10-01", period_end_date: "2026-10-06", minimum_notice_minutes: 1440 },
      now,
      CR,
    );
    expect(r).toEqual({ ok: true, warnings: ["no_slots_possible"] });
  });

  it("rechaza buffers e intervalos fuera de las opciones y topes menores a 1", () => {
    expect(validateLimits({ ...base, before_buffer_minutes: 7 }, now, CR).ok).toBe(false);
    expect(validateLimits({ ...base, slot_interval_minutes: 25 }, now, CR).ok).toBe(false);
    expect(validateLimits({ ...base, max_per_day: 0 }, now, CR).ok).toBe(false);
    expect(validateLimits({ ...base, period_type: "rolling_business", period_days: null }, now, CR).ok).toBe(false);
  });
});
