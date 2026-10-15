import { describe, expect, it } from "vitest";
import { lastDayOfMonth, localToday, monthEnd, monthLabel, nextMonthKey, previousMonthKey, weekEnd, weekStart, weekdayOf } from "./dates";

describe("fechas civiles", () => {
  it("último día de cada mes (bisiesto incluido)", () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 4)).toBe(30);
    expect(monthEnd("2026-10")).toBe("2026-10-31");
  });
  it("mes siguiente y anterior cruzan el año", () => {
    expect(nextMonthKey("2026-12")).toBe("2027-01");
    expect(previousMonthKey("2027-01")).toBe("2026-12");
  });
  it("la semana va de lunes a domingo", () => {
    expect(weekdayOf("2026-10-14")).toBe(3); // miércoles
    expect(weekStart("2026-10-14")).toBe("2026-10-12");
    expect(weekEnd("2026-10-14")).toBe("2026-10-18");
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // domingo
    expect(weekStart("2026-10-12")).toBe("2026-10-12"); // lunes
  });
  it("nombre del mes", () => {
    expect(monthLabel("2026-10")).toBe("octubre 2026");
  });
  it("«hoy» sale de la zona del workspace: 23:30 y 00:30 hora de Costa Rica", () => {
    expect(localToday(new Date("2026-10-11T05:30:00Z"), "America/Costa_Rica")).toBe("2026-10-10"); // 23:30 del 10
    expect(localToday(new Date("2026-10-11T06:30:00Z"), "America/Costa_Rica")).toBe("2026-10-11"); // 00:30 del 11
    expect(localToday(new Date("2026-11-01T05:30:00Z"), "UTC")).toBe("2026-11-01");
  });
});
