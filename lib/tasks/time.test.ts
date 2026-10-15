import { describe, expect, it } from "vitest";
import { DURATION_OPTIONS, formatDuration, formatTime, isTimeOfDay, isValidDuration, minutesToTime, normalizeTime, timeToMinutes } from "./time";

describe("hora de una tarea (R6)", () => {
  it("normaliza lo que devuelve la base (HH:MM:SS) a HH:MM", () => {
    expect(normalizeTime("14:30:00")).toBe("14:30");
    expect(normalizeTime("09:05")).toBe("09:05");
    expect(normalizeTime("24:00")).toBeNull();
    expect(normalizeTime("9:05")).toBeNull();
    expect(normalizeTime("")).toBeNull();
    expect(normalizeTime(null)).toBeNull();
  });

  it("valida el formato HH:MM", () => {
    expect(isTimeOfDay("00:00")).toBe(true);
    expect(isTimeOfDay("23:59")).toBe(true);
    expect(isTimeOfDay("23:60")).toBe(false);
    expect(isTimeOfDay("1430")).toBe(false);
    expect(isTimeOfDay(1430)).toBe(false);
  });

  it("ida y vuelta con los minutos", () => {
    expect(timeToMinutes("14:30:00")).toBe(870);
    expect(minutesToTime(870)).toBe("14:30");
    expect(minutesToTime(-5)).toBe("00:00");
    expect(minutesToTime(99999)).toBe("23:59");
    expect(timeToMinutes(null)).toBeNull();
  });

  it("formatTime: 24 h y 12 h", () => {
    expect(formatTime("14:30:00", "24h")).toBe("14:30");
    expect(formatTime("14:30", "12h")).toBe("2:30 p. m.");
    expect(formatTime("00:05", "12h")).toBe("12:05 a. m.");
    expect(formatTime("12:00", "12h")).toBe("12:00 p. m.");
    expect(formatTime(null, "12h")).toBe("");
  });

  it("duracion: de 5 a 1440, entera", () => {
    expect(isValidDuration(5)).toBe(true);
    expect(isValidDuration(1440)).toBe(true);
    expect(isValidDuration(4)).toBe(false);
    expect(isValidDuration(1441)).toBe(false);
    expect(isValidDuration(30.5)).toBe(false);
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(null)).toBe("");
  });
});

describe("las duraciones que ofrece el drawer", () => {
  it("van de 15 minutos a 8 horas y todas son validas", () => {
    expect(DURATION_OPTIONS.map((m) => formatDuration(m))).toEqual(["15 min", "30 min", "45 min", "1 h", "2 h", "3 h", "4 h", "5 h", "6 h", "7 h", "8 h"]);
    expect(DURATION_OPTIONS.every((m) => isValidDuration(m))).toBe(true);
  });
});
