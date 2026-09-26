import { describe, it, expect } from "vitest";
import { summarizeSchedule, daysLabel, joinSpanish, shortTime } from "./schedules";
import { defaultWeeklyHours } from "./availability-schema";

describe("summarizeSchedule (F10)", () => {
  it("agrupa días consecutivos con los mismos rangos", () => {
    const r = { "1": [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }] };
    expect(
      summarizeSchedule({ "1": r["1"], "2": r["1"], "3": r["1"], "4": r["1"], "5": r["1"] }),
    ).toBe("Lun a Vie, 9:00–12:00 y 14:00–18:00");
  });

  it("el horario normal", () => {
    expect(summarizeSchedule(defaultWeeklyHours())).toBe("Lun a Vie, 9:00–17:00");
  });

  it("días no consecutivos se listan, y grupos distintos se separan con ·", () => {
    const manana = [{ start: "09:00", end: "13:00" }];
    const tarde = [{ start: "15:00", end: "19:00" }];
    expect(summarizeSchedule({ "1": manana, "3": manana, "5": manana, "6": tarde })).toBe(
      "Lun, Mié y Vie, 9:00–13:00 · Sáb, 15:00–19:00",
    );
  });

  it("dos días consecutivos van con 'y', tres o más con 'a'", () => {
    expect(daysLabel([1, 2])).toBe("Lun y Mar");
    expect(daysLabel([1, 2, 3, 5])).toBe("Lun a Mié y Vie");
    expect(daysLabel([0, 6])).toBe("Sáb y Dom");
  });

  it("el orden de los rangos no importa y 24:00 se muestra tal cual", () => {
    expect(
      summarizeSchedule({ "0": [{ start: "20:00", end: "24:00" }, { start: "08:00", end: "10:00" }] }),
    ).toBe("Dom, 8:00–10:00 y 20:00–24:00");
  });

  it("sin días es 'Sin horarios'", () => {
    expect(summarizeSchedule({})).toBe("Sin horarios");
    expect(summarizeSchedule({ "1": [] })).toBe("Sin horarios");
  });

  it("helpers", () => {
    expect(joinSpanish(["a"])).toBe("a");
    expect(joinSpanish(["a", "b", "c"])).toBe("a, b y c");
    expect(shortTime("09:05")).toBe("9:05");
  });
});
