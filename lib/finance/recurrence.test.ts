import { afterEach, describe, expect, it } from "vitest";
import { localToday } from "./dates";
import {
  addDaysCivil,
  compareCivil,
  firstOccurrenceOnOrAfter,
  getPendingPaymentDates,
  isValidCivil,
  lastDayOfMonth,
  nextOccurrence,
  validateRecurrenceRule,
  type RecurrenceRule,
  type RecurrenceTemplate,
} from "./recurrence";

const tpl = (rule: RecurrenceRule, startDate: string, endDate: string | null = null): RecurrenceTemplate => ({ rule, startDate, endDate });
const monthly = (day: number, startDate = "2026-01-01", endDate: string | null = null) => tpl({ frequency: "monthly", monthlyDay: day }, startDate, endDate);

describe("mensual", () => {
  it("día 31 en febrero cae el último día (2027 y 2028 bisiesto)", () => {
    expect(getPendingPaymentDates(monthly(31, "2027-01-01"), "2027-02-01", "2027-02-28", 0)).toEqual(["2027-02-28"]);
    expect(getPendingPaymentDates(monthly(31, "2028-01-01"), "2028-02-01", "2028-02-29", 0)).toEqual(["2028-02-29"]);
  });
  it("día 30 en febrero de 2026 cae el 28", () => {
    expect(getPendingPaymentDates(monthly(30), "2026-02-01", "2026-02-28", 0)).toEqual(["2026-02-28"]);
  });
  it("día 31 en abril cae el 30", () => {
    expect(getPendingPaymentDates(monthly(31), "2026-04-01", "2026-04-30", 0)).toEqual(["2026-04-30"]);
  });
  it("un año entero: doce fechas, una por mes, con el recorte de cada mes", () => {
    expect(getPendingPaymentDates(monthly(31), "2026-01-01", "2026-12-31", 0)).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30",
      "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31",
    ]);
  });
  it("un inicio a mitad de mes con día 5: la primera fecha es el 5 del mes siguiente", () => {
    const dates = getPendingPaymentDates(monthly(5, "2026-10-12"), "2026-01-01", "2027-01-31", 0);
    expect(dates[0]).toBe("2026-11-05");
    expect(dates).not.toContain("2026-10-05");
  });
  it("el inicio es inclusivo: un día 12 con inicio el 12 incluye el 12", () => {
    expect(getPendingPaymentDates(monthly(12, "2026-10-12"), "2026-10-01", "2026-10-31", 0)).toEqual(["2026-10-12"]);
  });
  it("sin fechas en el rango devuelve []", () => {
    expect(getPendingPaymentDates(monthly(5), "2026-10-06", "2026-10-31", 0)).toEqual([]);
    expect(getPendingPaymentDates(monthly(5), "2026-11-01", "2026-10-01", 0)).toEqual([]);
  });
});

describe("anual", () => {
  const yearly = (month: number, day: number, start = "2026-01-01") => tpl({ frequency: "yearly", yearlyMonth: month, yearlyDay: day }, start);
  it("29/02 cae el 28/02 en 2027 y el 29/02 en 2028", () => {
    expect(getPendingPaymentDates(yearly(2, 29), "2027-01-01", "2027-12-31", 0)).toEqual(["2027-02-28"]);
    expect(getPendingPaymentDates(yearly(2, 29), "2028-01-01", "2028-12-31", 0)).toEqual(["2028-02-29"]);
    expect(getPendingPaymentDates(yearly(2, 29), "2027-01-01", "2028-12-31", 0)).toEqual(["2027-02-28", "2028-02-29"]);
  });
  it("una fecha normal sale una vez por año", () => {
    expect(getPendingPaymentDates(yearly(3, 15), "2026-01-01", "2028-12-31", 0)).toEqual(["2026-03-15", "2027-03-15", "2028-03-15"]);
  });
  it("respeta el inicio: el primer pago es el del año en que arranca (si todavía no pasó)", () => {
    expect(getPendingPaymentDates(yearly(3, 15, "2026-04-01"), "2026-01-01", "2028-12-31", 0)).toEqual(["2027-03-15", "2028-03-15"]);
  });
  it("con anticipación cruza el año: el 15/01 entra el 31/12 con 20 días de anticipación, no con 7", () => {
    const t = yearly(1, 15);
    expect(getPendingPaymentDates(t, "2027-01-01", "2026-12-31", 20)).toContain("2027-01-15");
    expect(getPendingPaymentDates(t, "2027-01-01", "2026-12-31", 7)).not.toContain("2027-01-15");
  });
});

describe("quincenal", () => {
  const biweekly = tpl({ frequency: "biweekly" }, "2026-01-01");
  it("febrero de 2026: 15 y 28", () => {
    expect(getPendingPaymentDates(biweekly, "2026-02-01", "2026-02-28", 0)).toEqual(["2026-02-15", "2026-02-28"]);
  });
  it("febrero de 2028 (bisiesto): 15 y 29", () => {
    expect(getPendingPaymentDates(biweekly, "2028-02-01", "2028-02-29", 0)).toEqual(["2028-02-15", "2028-02-29"]);
  });
  it("meses de 30 y 31 días", () => {
    expect(getPendingPaymentDates(biweekly, "2026-04-01", "2026-05-31", 0)).toEqual(["2026-04-15", "2026-04-30", "2026-05-15", "2026-05-31"]);
  });
  it("con un inicio el 20, la primera es el último día del mes", () => {
    expect(getPendingPaymentDates(tpl({ frequency: "biweekly" }, "2026-10-20"), "2026-10-01", "2026-11-30", 0)).toEqual(["2026-10-31", "2026-11-15", "2026-11-30"]);
  });
  it("la anticipación cruza de mes: el 15/11 con 7 días se crea el 8/11", () => {
    expect(getPendingPaymentDates(biweekly, "2026-11-01", "2026-11-08", 7)).toContain("2026-11-15");
    expect(getPendingPaymentDates(biweekly, "2026-11-01", "2026-11-07", 7)).not.toContain("2026-11-15");
  });
});

describe("semanal", () => {
  // 2026-12-21 es lunes.
  const everyTwoWeeks = tpl({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 2 }, "2026-12-21");
  it("cambio de año, cada 2 semanas desde el lunes 2026-12-21, sin correr la cadencia", () => {
    expect(getPendingPaymentDates(everyTwoWeeks, "2026-12-21", "2027-01-18", 0)).toEqual(["2026-12-21", "2027-01-04", "2027-01-18"]);
  });
  it("con `from` posterior a varias ocurrencias la cadencia original se mantiene", () => {
    // Desde 2027-01-05 el siguiente de la cadena es 01-18, no 01-05 ni 01-12.
    expect(getPendingPaymentDates(everyTwoWeeks, "2027-01-05", "2027-02-15", 0)).toEqual(["2027-01-18", "2027-02-01", "2027-02-15"]);
    expect(getPendingPaymentDates(everyTwoWeeks, "2027-01-18", "2027-01-18", 0)).toEqual(["2027-01-18"]);
  });
  it("la primera ocurrencia es el primer día de la semana >= inicio", () => {
    // El inicio cae un jueves (2026-10-15) y la plantilla es de lunes: la primera es el 2026-10-19.
    const t = tpl({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 1 }, "2026-10-15");
    expect(getPendingPaymentDates(t, "2026-10-01", "2026-11-02", 0)).toEqual(["2026-10-19", "2026-10-26", "2026-11-02"]);
    // Si el inicio cae justo en el día, cuenta.
    const sameDay = tpl({ frequency: "weekly", weeklyDay: 4, weeklyInterval: 1 }, "2026-10-15");
    expect(getPendingPaymentDates(sameDay, "2026-10-01", "2026-10-22", 0)).toEqual(["2026-10-15", "2026-10-22"]);
  });
  it("domingo es 0 y sábado es 6", () => {
    const sunday = tpl({ frequency: "weekly", weeklyDay: 0, weeklyInterval: 1 }, "2026-10-12");
    expect(getPendingPaymentDates(sunday, "2026-10-12", "2026-10-26", 0)).toEqual(["2026-10-18", "2026-10-25"]);
  });
  it("cada 52 semanas salta un año de calendario", () => {
    const t = tpl({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 52 }, "2026-10-12");
    expect(getPendingPaymentDates(t, "2026-10-12", "2028-12-31", 0)).toEqual(["2026-10-12", "2027-10-11", "2028-10-09"]);
  });
  it("la anticipación también extiende el rango semanal", () => {
    expect(getPendingPaymentDates(everyTwoWeeks, "2027-01-01", "2026-12-28", 7)).toEqual(["2027-01-04"]);
    expect(getPendingPaymentDates(everyTwoWeeks, "2027-01-01", "2026-12-27", 7)).toEqual([]);
  });
});

describe("anticipación («crear N días antes»)", () => {
  it("cambio de año: mensual día 3, lead 7: con to = 2026-12-27 incluye 2027-01-03; con 2026-12-26, no", () => {
    expect(getPendingPaymentDates(monthly(3), "2026-12-04", "2026-12-27", 7)).toContain("2027-01-03");
    expect(getPendingPaymentDates(monthly(3), "2026-12-04", "2026-12-26", 7)).not.toContain("2027-01-03");
  });
  it("cruza de mes (bug de prevxcrm): mensual día 5, lead 7, to = 2026-10-30 incluye 2026-11-05", () => {
    expect(getPendingPaymentDates(monthly(5), "2026-10-01", "2026-10-30", 7)).toContain("2026-11-05");
    expect(getPendingPaymentDates(monthly(5), "2026-10-01", "2026-10-28", 7)).not.toContain("2026-11-05");
  });
  it("lead negativo o inválido se toma como 0", () => {
    expect(getPendingPaymentDates(monthly(5), "2026-10-06", "2026-10-30", -5)).toEqual([]);
    expect(getPendingPaymentDates(monthly(5), "2026-10-06", "2026-10-30", Number.NaN)).toEqual([]);
  });
});

describe("fecha de fin", () => {
  it("se compara contra la fecha de PAGO (bug de prevxcrm): fin 2026-10-03, día 10, lead 7, to = 2026-10-03 no incluye el 10/10", () => {
    const t = monthly(10, "2026-01-01", "2026-10-03");
    expect(getPendingPaymentDates(t, "2026-10-01", "2026-10-03", 7)).not.toContain("2026-10-10");
    expect(getPendingPaymentDates(t, "2026-10-01", "2026-10-03", 7)).toEqual([]);
  });
  it("es inclusiva: un pago justo el día del fin entra", () => {
    const t = monthly(10, "2026-01-01", "2026-10-10");
    expect(getPendingPaymentDates(t, "2026-10-01", "2026-12-31", 0)).toEqual(["2026-10-10"]);
  });
  it("corta también las semanales", () => {
    const t = tpl({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 1 }, "2026-10-05", "2026-10-14");
    expect(getPendingPaymentDates(t, "2026-10-01", "2026-12-31", 0)).toEqual(["2026-10-05", "2026-10-12"]);
  });
});

describe("zona horaria", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  const suite = (): Record<string, unknown> => ({
    monthly31: getPendingPaymentDates(monthly(31, "2026-01-01"), "2026-01-01", "2028-03-01", 7),
    biweekly: getPendingPaymentDates(tpl({ frequency: "biweekly" }, "2026-01-01"), "2026-02-01", "2026-04-30", 3),
    yearly: getPendingPaymentDates(tpl({ frequency: "yearly", yearlyMonth: 2, yearlyDay: 29 }, "2026-01-01"), "2026-01-01", "2030-12-31", 0),
    weekly: getPendingPaymentDates(tpl({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 2 }, "2026-12-21"), "2027-01-05", "2027-06-30", 7),
    // Fechas pegadas a los cambios de horario de verano de Estados Unidos y Europa.
    dst: getPendingPaymentDates(monthly(8, "2026-01-01"), "2026-03-01", "2026-04-30", 0).concat(getPendingPaymentDates(monthly(29, "2026-01-01"), "2026-10-01", "2026-10-31", 0)),
    next: nextOccurrence(monthly(31), "2026-10-31"),
    add: addDaysCivil("2026-03-08", 1),
  });

  it("los resultados son idénticos con el reloj del proceso en Tokio y en Los Ángeles", () => {
    process.env.TZ = "Asia/Tokyo";
    const tokyo = suite();
    const tokyoOffset = new Date(2026, 0, 1).getTimezoneOffset();
    process.env.TZ = "America/Los_Angeles";
    const losAngeles = suite();
    const laOffset = new Date(2026, 0, 1).getTimezoneOffset();
    // Si el proceso aceptó el cambio de zona, las dos zonas se distinguen: la prueba tiene sentido.
    expect(tokyoOffset).not.toBe(laOffset);
    expect(losAngeles).toEqual(tokyo);
    expect(tokyo.add).toBe("2026-03-09");
    expect(tokyo.yearly).toEqual(["2026-02-28", "2027-02-28", "2028-02-29", "2029-02-28", "2030-02-28"]);
  });
});

describe("auxiliares", () => {
  it("lastDayOfMonth, addDaysCivil y compareCivil", () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
    expect(addDaysCivil("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysCivil("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysCivil("2026-03-01", -1)).toBe("2026-02-28");
    expect(compareCivil("2026-10-01", "2026-10-02")).toBe(-1);
    expect(compareCivil("2026-10-02", "2026-10-02")).toBe(0);
    expect(compareCivil("2027-01-01", "2026-12-31")).toBe(1);
  });
  it("`localToday` da el día de la zona del workspace", () => {
    expect(localToday(new Date("2026-11-01T05:30:00Z"), "America/Costa_Rica")).toBe("2026-10-31");
    expect(localToday(new Date("2026-11-01T05:30:00Z"), "UTC")).toBe("2026-11-01");
  });
  it("isValidCivil rechaza lo que Date.parse deja pasar", () => {
    expect(isValidCivil("2026-02-30")).toBe(false);
    expect(isValidCivil("2026-04-31")).toBe(false);
    expect(isValidCivil("2028-02-29")).toBe(true);
    expect(isValidCivil("2027-02-29")).toBe(false);
    expect(isValidCivil("2026-13-01")).toBe(false);
    expect(isValidCivil("26-1-1")).toBe(false);
    expect(isValidCivil(20261001)).toBe(false);
  });
});

describe("nextOccurrence", () => {
  it("es estrictamente posterior a `after`", () => {
    expect(nextOccurrence(monthly(5), "2026-10-05")).toBe("2026-11-05");
    expect(nextOccurrence(monthly(5), "2026-10-04")).toBe("2026-10-05");
    expect(firstOccurrenceOnOrAfter(monthly(5), "2026-10-05")).toBe("2026-10-05");
  });
  it("antes del inicio devuelve la primera fecha de la plantilla", () => {
    expect(nextOccurrence(monthly(5, "2027-03-10"), "2026-01-01")).toBe("2027-04-05");
  });
  it("devuelve null cuando la fecha de fin ya no deja ninguna", () => {
    expect(nextOccurrence(monthly(5, "2026-01-01", "2026-10-31"), "2026-10-05")).toBeNull();
    expect(nextOccurrence(monthly(5, "2026-01-01", "2026-11-05"), "2026-10-05")).toBe("2026-11-05");
  });
  it("sirve para todas las frecuencias, incluida una semanal cada 52 semanas", () => {
    expect(nextOccurrence(tpl({ frequency: "biweekly" }, "2026-01-01"), "2026-10-15")).toBe("2026-10-31");
    expect(nextOccurrence(tpl({ frequency: "yearly", yearlyMonth: 3, yearlyDay: 15 }, "2026-01-01"), "2026-03-15")).toBe("2027-03-15");
    expect(nextOccurrence(tpl({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 52 }, "2026-10-12"), "2026-10-12")).toBe("2027-10-11");
  });
});

describe("validateRecurrenceRule", () => {
  it("rechaza el 31 de abril y acepta el 29 de febrero", () => {
    const bad = validateRecurrenceRule({ frequency: "yearly", yearlyMonth: 4, yearlyDay: 31 });
    expect(bad.ok).toBe(false);
    const feb = validateRecurrenceRule({ frequency: "yearly", yearlyMonth: 2, yearlyDay: 29 });
    expect(feb).toEqual({ ok: true, rule: { frequency: "yearly", yearlyMonth: 2, yearlyDay: 29 } });
    expect(validateRecurrenceRule({ frequency: "yearly", yearlyMonth: 2, yearlyDay: 30 }).ok).toBe(false);
    expect(validateRecurrenceRule({ frequency: "yearly", yearlyMonth: 12, yearlyDay: 31 }).ok).toBe(true);
  });
  it("semanal: intervalo 1..52 y día 0..6", () => {
    expect(validateRecurrenceRule({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 1 }).ok).toBe(true);
    expect(validateRecurrenceRule({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 52 }).ok).toBe(true);
    expect(validateRecurrenceRule({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 0 }).ok).toBe(false);
    expect(validateRecurrenceRule({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 53 }).ok).toBe(false);
    expect(validateRecurrenceRule({ frequency: "weekly", weeklyDay: 7, weeklyInterval: 1 }).ok).toBe(false);
    expect(validateRecurrenceRule({ frequency: "weekly", weeklyDay: 1.5, weeklyInterval: 1 }).ok).toBe(false);
    expect(validateRecurrenceRule({ frequency: "weekly", weeklyDay: 1 }).ok).toBe(false);
  });
  it("mensual: día 1..31", () => {
    expect(validateRecurrenceRule({ frequency: "monthly", monthlyDay: 31 }).ok).toBe(true);
    expect(validateRecurrenceRule({ frequency: "monthly", monthlyDay: 0 }).ok).toBe(false);
    expect(validateRecurrenceRule({ frequency: "monthly", monthlyDay: 32 }).ok).toBe(false);
    expect(validateRecurrenceRule({ frequency: "monthly" }).ok).toBe(false);
  });
  it("quincenal no pide nada; una frecuencia desconocida se rechaza con un mensaje", () => {
    expect(validateRecurrenceRule({ frequency: "biweekly" })).toEqual({ ok: true, rule: { frequency: "biweekly" } });
    const unknown = validateRecurrenceRule({ frequency: "daily" });
    expect(unknown.ok).toBe(false);
    expect(validateRecurrenceRule(null).ok).toBe(false);
  });
  it("el error viene en castellano", () => {
    const r = validateRecurrenceRule({ frequency: "monthly", monthlyDay: 40 });
    expect(r).toEqual({ ok: false, error: "El día del mes va de 1 a 31" });
  });
});
