import { describe, it, expect } from "vitest";
import { buildMonthView, addMonths, daysInMonth, firstMonthWithSlots } from "./month-view";
import type { SlotsByDate } from "../types";

const CR = "America/Costa_Rica";
const slot = (iso: string) => ({ startUtc: iso, endUtc: iso });
const slots: SlotsByDate = {
  "2026-10-06": [slot("2026-10-06T15:00:00.000Z"), slot("2026-10-06T15:30:00.000Z")],
  "2026-10-09": [slot("2026-10-09T15:00:00.000Z")],
  "2026-10-12": [],
  "2026-12-01": [slot("2026-12-01T15:00:00.000Z")],
};

describe("buildMonthView (F25)", () => {
  const view = buildMonthView(slots, "2026-10", CR, new Date("2026-10-04T12:00:00.000Z"));

  it("marca como disponibles exactamente los días con al menos un horario", () => {
    expect(view.availableDates).toEqual(["2026-10-06", "2026-10-09"]);
    const days = view.weeks.flat().filter((d) => d.isCurrentMonth);
    expect(days.filter((d) => d.available).map((d) => d.date)).toEqual(["2026-10-06", "2026-10-09"]);
    expect(days.find((d) => d.date === "2026-10-06")?.slotCount).toBe(2);
    expect(days.find((d) => d.date === "2026-10-12")?.available).toBe(false);
  });

  it("semanas de lunes a domingo con relleno, y hoy marcado", () => {
    expect(view.weeks).toHaveLength(5); // octubre 2026: jueves 1 a sábado 31 → 5 semanas
    expect(view.weeks[0][0]).toMatchObject({ date: "2026-09-28", isCurrentMonth: false });
    expect(view.weeks.at(-1)?.at(-1)).toMatchObject({ date: "2026-11-01", isCurrentMonth: false });
    expect(view.weeks.flat().find((d) => d.isToday)?.date).toBe("2026-10-04");
  });

  it("apunta al próximo y al anterior mes con horarios", () => {
    expect(view.nextMonthWithSlots).toBe("2026-12");
    expect(view.prevMonthWithSlots).toBeNull();
    const noviembre = buildMonthView(slots, "2026-11", CR);
    expect(noviembre.hasAnySlots).toBe(false);
    expect(noviembre.nextMonthWithSlots).toBe("2026-12");
    expect(noviembre.prevMonthWithSlots).toBe("2026-10");
  });

  it("helpers de mes", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(daysInMonth("2028-02")).toBe(29);
    expect(firstMonthWithSlots(slots)).toBe("2026-10");
    expect(firstMonthWithSlots({ "2026-10-12": [] })).toBeNull();
  });
});
