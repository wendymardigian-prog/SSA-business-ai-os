import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatInTz,
  dateInTz,
  weekdayInTz,
  addDays,
  isValidDateString,
  isValidWallTime,
  wallTimeToMinutes,
  minutesToWallTime,
  wallClockToUtc,
  rangeForFilter,
  eachDate,
} from "./tz";

const CR = "America/Costa_Rica"; // UTC-6 todo el año
const NY = "America/New_York"; // DST: empieza dom 8/3/2026, termina dom 1/11/2026

afterEach(() => {
  vi.useRealTimers();
});

describe("formatInTz / dateInTz / weekdayInTz", () => {
  it("formatea en la zona pedida", () => {
    const t = "2026-10-06T18:30:00.000Z";
    expect(formatInTz(t, CR, "YYYY-MM-DD HH:mm")).toBe("2026-10-06 12:30");
    expect(formatInTz(t, "Asia/Tokyo", "YYYY-MM-DD HH:mm")).toBe("2026-10-07 03:30");
  });

  it("la fecha civil cambia según la zona", () => {
    const t = "2026-10-02T05:30:00.000Z"; // 23:30 del 1/10 en Costa Rica
    expect(dateInTz(t, CR)).toBe("2026-10-01");
    expect(dateInTz(t, "UTC")).toBe("2026-10-02");
    expect(weekdayInTz(t, CR)).toBe(4); // jueves
    expect(weekdayInTz(t, "UTC")).toBe(5); // viernes
  });
});

describe("helpers de fecha y hora de pared", () => {
  it("addDays cruza el mes y el año", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("valida fechas reales", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2026-02-31")).toBe(false);
    expect(isValidDateString("26-2-1")).toBe(false);
    expect(isValidDateString(null)).toBe(false);
  });

  it("valida horas HH:mm y acepta 24:00 solo como fin", () => {
    expect(isValidWallTime("09:00")).toBe(true);
    expect(isValidWallTime("24:00")).toBe(true);
    expect(isValidWallTime("24:30")).toBe(false);
    expect(isValidWallTime("9:00")).toBe(false);
    expect(isValidWallTime("25:00")).toBe(false);
  });

  it("convierte entre minutos y HH:mm", () => {
    expect(wallTimeToMinutes("09:30")).toBe(570);
    expect(wallTimeToMinutes("24:00")).toBe(1440);
    expect(minutesToWallTime(570)).toBe("09:30");
    expect(minutesToWallTime(1440)).toBe("24:00");
  });

  it("eachDate incluye los dos extremos", () => {
    expect(eachDate("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });
});

describe("wallClockToUtc", () => {
  it("zona sin horario de verano", () => {
    expect(wallClockToUtc("2026-12-20", "00:00", CR).toISOString()).toBe("2026-12-20T06:00:00.000Z");
    expect(wallClockToUtc("2026-12-31", "24:00", CR).toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });

  it("New York antes y después del cambio de marzo", () => {
    // Viernes 6/3: todavía EST (UTC-5). Lunes 9/3: ya EDT (UTC-4).
    expect(wallClockToUtc("2026-03-06", "09:00", NY).toISOString()).toBe("2026-03-06T14:00:00.000Z");
    expect(wallClockToUtc("2026-03-09", "09:00", NY).toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });

  it("New York antes y después del cambio de noviembre", () => {
    expect(wallClockToUtc("2026-10-30", "09:00", NY).toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(wallClockToUtc("2026-11-02", "09:00", NY).toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
});

describe("rangeForFilter", () => {
  it("'Hoy' en Costa Rica a las 23:30 del 1/10 sigue siendo el 1/10 (criterio F8)", () => {
    const now = new Date("2026-10-02T05:30:00.000Z"); // 23:30 del 1/10 hora local
    expect(rangeForFilter("today", CR, now)).toEqual({
      fromUtc: "2026-10-01T06:00:00.000Z",
      toUtc: "2026-10-02T06:00:00.000Z",
    });
  });

  it("'Hoy' usa el reloj del sistema si no se pasa now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T16:10:00.000Z"));
    expect(rangeForFilter("today", CR).fromUtc).toBe("2026-10-06T06:00:00.000Z");
  });

  it("'Esta semana' va de lunes a lunes en la zona", () => {
    // Martes 6/10/2026 10:10 en Costa Rica
    const now = new Date("2026-10-06T16:10:00.000Z");
    expect(rangeForFilter("this_week", CR, now)).toEqual({
      fromUtc: "2026-10-05T06:00:00.000Z", // lunes 5/10
      toUtc: "2026-10-12T06:00:00.000Z", // lunes 12/10
    });
  });

  it("'Esta semana' un domingo pertenece a la semana que empezó el lunes anterior", () => {
    const now = new Date("2026-10-11T20:00:00.000Z"); // domingo 11/10 14:00 CR
    expect(rangeForFilter("this_week", CR, now).fromUtc).toBe("2026-10-05T06:00:00.000Z");
  });

  it("'Esta semana' cruza el cambio de horario de New York con días de distinto largo", () => {
    const now = new Date("2026-03-04T15:00:00.000Z"); // miércoles 4/3
    expect(rangeForFilter("this_week", NY, now)).toEqual({
      fromUtc: "2026-03-02T05:00:00.000Z", // lunes 2/3 EST
      toUtc: "2026-03-09T04:00:00.000Z", // lunes 9/3 ya EDT
    });
  });

  it("rango explícito: día completo de punta a punta, fin exclusivo", () => {
    expect(rangeForFilter({ from: "2026-10-01", to: "2026-10-03" }, CR)).toEqual({
      fromUtc: "2026-10-01T06:00:00.000Z",
      toUtc: "2026-10-04T06:00:00.000Z",
    });
  });

  it("rango explícito al revés se da vuelta", () => {
    expect(rangeForFilter({ from: "2026-10-03", to: "2026-10-01" }, CR)).toEqual(
      rangeForFilter({ from: "2026-10-01", to: "2026-10-03" }, CR),
    );
  });

  it("rango explícito con fecha inválida lanza", () => {
    expect(() => rangeForFilter({ from: "ayer", to: "2026-10-01" }, CR)).toThrow();
  });
});
