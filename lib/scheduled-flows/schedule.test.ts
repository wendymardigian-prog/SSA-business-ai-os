import { describe, expect, it } from "vitest";
import {
  describeSchedule,
  isOccurrenceOf,
  isTooLate,
  nextOccurrence,
  parseScheduleConfig,
  parseScheduledRunPayload,
  scheduleProblems,
  scheduleVariables,
  SCHEDULE_NO_DATE_PROBLEM,
  SCHEDULE_NO_MONTH_DAY_PROBLEM,
  SCHEDULE_NO_TIME_PROBLEM,
  SCHEDULE_NO_WEEKDAYS_PROBLEM,
} from "./schedule";

const BA = "America/Argentina/Buenos_Aires"; // UTC-3, sin horario de verano
const NY = "America/New_York"; // con horario de verano
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("parseScheduleConfig", () => {
  it("lee con tolerancia y deja vacío lo que no sirve", () => {
    expect(parseScheduleConfig({ repeat: "weekly", time: "9:00", date: "2026-02-30", weekdays: [5, 1, 1, 9, "3"], monthDay: 40 })).toEqual({
      repeat: "weekly",
      date: null,
      time: null,
      weekdays: [1, 3, 5],
      monthDay: null,
    });
    expect(parseScheduleConfig(null).repeat).toBe("once");
    expect(parseScheduleConfig({ repeat: "hourly" }).repeat).toBe("once");
  });
});

describe("scheduleProblems", () => {
  it("una vez pide fecha y hora", () => {
    expect(scheduleProblems({ repeat: "once" })).toEqual([SCHEDULE_NO_DATE_PROBLEM, SCHEDULE_NO_TIME_PROBLEM]);
    expect(scheduleProblems({ repeat: "once", date: "2026-11-10", time: "09:00" })).toEqual([]);
  });
  it("cada semana pide al menos un día; cada mes, el día", () => {
    expect(scheduleProblems({ repeat: "weekly", time: "09:00" })).toEqual([SCHEDULE_NO_WEEKDAYS_PROBLEM]);
    expect(scheduleProblems({ repeat: "monthly", time: "09:00" })).toEqual([SCHEDULE_NO_MONTH_DAY_PROBLEM]);
    expect(scheduleProblems({ repeat: "daily", time: "09:00" })).toEqual([]);
  });
});

describe("nextOccurrence", () => {
  // Domingo 8/11/2026, 10:00 en Buenos Aires = 13:00 UTC.
  const now = new Date("2026-11-08T13:00:00.000Z");

  it("una vez: la fecha y hora del negocio, o nada si ya pasó", () => {
    expect(iso(nextOccurrence({ repeat: "once", date: "2026-11-09", time: "09:00" }, now, BA))).toBe("2026-11-09T12:00:00.000Z");
    expect(nextOccurrence({ repeat: "once", date: "2026-11-08", time: "09:00" }, now, BA)).toBeNull();
    // Exactamente ahora no cuenta: es «después de».
    expect(nextOccurrence({ repeat: "once", date: "2026-11-08", time: "10:00" }, now, BA)).toBeNull();
  });

  it("todos los días: hoy si la hora no llegó, si no mañana", () => {
    expect(iso(nextOccurrence({ repeat: "daily", time: "18:30" }, now, BA))).toBe("2026-11-08T21:30:00.000Z");
    expect(iso(nextOccurrence({ repeat: "daily", time: "08:00" }, now, BA))).toBe("2026-11-09T11:00:00.000Z");
  });

  it("cada semana: el próximo de los días elegidos", () => {
    // Lunes (1) y jueves (4) a las 9: el lunes 9.
    expect(iso(nextOccurrence({ repeat: "weekly", weekdays: [1, 4], time: "09:00" }, now, BA))).toBe("2026-11-09T12:00:00.000Z");
    // Domingo (0) a las 9: ya pasó hoy, el domingo siguiente.
    expect(iso(nextOccurrence({ repeat: "weekly", weekdays: [0], time: "09:00" }, now, BA))).toBe("2026-11-15T12:00:00.000Z");
  });

  it("cada mes: el día elegido, o el último si el mes no lo tiene", () => {
    expect(iso(nextOccurrence({ repeat: "monthly", monthDay: 8, time: "11:00" }, now, BA))).toBe("2026-11-08T14:00:00.000Z");
    expect(iso(nextOccurrence({ repeat: "monthly", monthDay: 8, time: "09:00" }, now, BA))).toBe("2026-12-08T12:00:00.000Z");
    // El 31: noviembre tiene 30.
    expect(iso(nextOccurrence({ repeat: "monthly", monthDay: 31, time: "09:00" }, now, BA))).toBe("2026-11-30T12:00:00.000Z");
    // Desde el 30/11 ya pasado: el 31 de diciembre.
    expect(iso(nextOccurrence({ repeat: "monthly", monthDay: 31, time: "09:00" }, new Date("2026-11-30T13:00:00.000Z"), BA))).toBe("2026-12-31T12:00:00.000Z");
    // Febrero de 2027 no es bisiesto: el 28.
    expect(iso(nextOccurrence({ repeat: "monthly", monthDay: 30, time: "09:00" }, new Date("2027-02-01T00:00:00.000Z"), BA))).toBe("2027-02-28T12:00:00.000Z");
  });

  it("la hora de pared se respeta con el cambio de horario de verano", () => {
    // Nueva York pasa a horario de invierno el domingo 1/11/2026: las 9 son 13:00 UTC antes y 14:00 UTC después.
    expect(iso(nextOccurrence({ repeat: "daily", time: "09:00" }, new Date("2026-10-31T12:00:00.000Z"), NY))).toBe("2026-10-31T13:00:00.000Z");
    expect(iso(nextOccurrence({ repeat: "daily", time: "09:00" }, new Date("2026-11-01T12:00:00.000Z"), NY))).toBe("2026-11-01T14:00:00.000Z");
  });

  it("la fecha del día sale de la zona del negocio, no de UTC", () => {
    // 23:30 del sábado 7/11 en Buenos Aires = 02:30 UTC del domingo 8: «hoy» sigue siendo el sábado.
    const lateSaturday = new Date("2026-11-08T02:30:00.000Z");
    expect(iso(nextOccurrence({ repeat: "weekly", weekdays: [6], time: "23:45" }, lateSaturday, BA))).toBe("2026-11-08T02:45:00.000Z");
  });

  it("sin hora o sin días, no hay próxima vez", () => {
    expect(nextOccurrence({ repeat: "daily" }, now, BA)).toBeNull();
    expect(nextOccurrence({ repeat: "weekly", time: "09:00" }, now, BA)).toBeNull();
  });
});

describe("isOccurrenceOf", () => {
  it("reconoce una vez de la config y descarta la de una config vieja", () => {
    const config = { repeat: "weekly", weekdays: [1], time: "09:00" };
    expect(isOccurrenceOf(config, new Date("2026-11-09T12:00:00.000Z"), BA)).toBe(true);
    // Era a las 10 antes de que alguien la cambiara a las 9.
    expect(isOccurrenceOf(config, new Date("2026-11-09T13:00:00.000Z"), BA)).toBe(false);
    // Un martes.
    expect(isOccurrenceOf(config, new Date("2026-11-10T12:00:00.000Z"), BA)).toBe(false);
  });
});

describe("isTooLate", () => {
  it("hasta dos horas tarde todavía corre", () => {
    const at = new Date("2026-11-09T12:00:00.000Z");
    expect(isTooLate(at, new Date("2026-11-09T12:01:00.000Z"))).toBe(false);
    expect(isTooLate(at, new Date("2026-11-09T14:00:00.000Z"))).toBe(false);
    expect(isTooLate(at, new Date("2026-11-09T14:01:00.000Z"))).toBe(true);
  });
});

describe("describeSchedule", () => {
  it("se lee en castellano", () => {
    expect(describeSchedule({ repeat: "once", date: "2026-11-09", time: "09:00" })).toBe("El 9 de noviembre de 2026 a las 09:00");
    expect(describeSchedule({ repeat: "daily", time: "18:30" })).toBe("Todos los días a las 18:30");
    expect(describeSchedule({ repeat: "weekly", weekdays: [1, 3, 5], time: "09:00" })).toBe("Cada lunes, miércoles y viernes a las 09:00");
    expect(describeSchedule({ repeat: "weekly", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "09:00" })).toBe("Todos los días a las 09:00");
    expect(describeSchedule({ repeat: "monthly", monthDay: 1, time: "10:00" })).toBe("El día 1 de cada mes a las 10:00");
    expect(describeSchedule({ repeat: "once" })).toBe("Elegí la fecha y la hora");
  });
});

describe("scheduleVariables", () => {
  it("la fecha, el día y la hora en la zona del negocio", () => {
    expect(scheduleVariables(new Date("2026-11-09T12:00:00.000Z"), BA)).toEqual({
      schedule: { date: "9 de noviembre de 2026", weekday: "lunes", time: "09:00", date_iso: "2026-11-09" },
    });
  });
});

describe("parseScheduledRunPayload", () => {
  it("exige lo mínimo", () => {
    const ok = { workspaceId: "w", flowId: "f", version: 3, occurrence: "2026-11-09T12:00:00.000Z" };
    expect(parseScheduledRunPayload(ok)).toEqual(ok);
    expect(parseScheduledRunPayload({ ...ok, version: "x" })).toBeNull();
    expect(parseScheduledRunPayload({ ...ok, occurrence: "mañana" })).toBeNull();
    expect(parseScheduledRunPayload(null)).toBeNull();
  });
});
