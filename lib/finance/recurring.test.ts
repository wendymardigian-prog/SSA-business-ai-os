import { describe, expect, it } from "vitest";
import { describeFrequency, editResetsAnchor, missedDatesOnReactivate, monthlyEquivalent, normalizeTemplate, recurringStatus, ruleFromRow, templateForEngine, type RecurringTemplateRow } from "./recurring";

const row = (over: Partial<RecurringTemplateRow> = {}): RecurringTemplateRow => ({
  concept: "Google Workspace",
  vendor_id: null,
  category_key: "software",
  amount_type: "fixed",
  amount: 36,
  charge_mode: "manual",
  frequency: "monthly",
  weekly_day: null,
  weekly_interval: null,
  monthly_day: 5,
  yearly_month: null,
  yearly_day: null,
  start_date: "2026-01-01",
  end_date: null,
  lead_days: 0,
  is_active: true,
  generation_anchor: "2026-01-01",
  responsible_id: null,
  notes: null,
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  concept: "Google Workspace",
  categoryKey: "software",
  amountType: "fixed",
  amount: 36,
  chargeMode: "manual",
  frequency: "monthly",
  monthlyDay: 5,
  startDate: "2026-10-01",
  ...over,
});

describe("recurringStatus", () => {
  it("activa por defecto", () => {
    expect(recurringStatus(row(), "2026-10-15")).toBe("active");
    expect(recurringStatus(row({ end_date: "2027-12-31" }), "2026-10-15")).toBe("active");
  });
  it("pausada si is_active = false, aunque además haya terminado", () => {
    expect(recurringStatus(row({ is_active: false }), "2026-10-15")).toBe("paused");
    expect(recurringStatus(row({ is_active: false, end_date: "2026-01-31" }), "2026-10-15")).toBe("paused");
  });
  it("terminada con fin ayer", () => {
    expect(recurringStatus(row({ end_date: "2026-10-14" }), "2026-10-15")).toBe("finished");
  });
  it("con fin hoy sigue activa solo si todavía le queda una fecha de pago ese día o después", () => {
    // Día 15 con fin el 15 y hoy 15: queda el pago de hoy.
    expect(recurringStatus(row({ monthly_day: 15, end_date: "2026-10-15" }), "2026-10-15")).toBe("active");
    // Día 5 con fin el 20/10 y hoy 15/10: el pago del 5/10 ya pasó y no hay otro antes del fin.
    expect(recurringStatus(row({ monthly_day: 5, end_date: "2026-10-20" }), "2026-10-15")).toBe("finished");
  });
  it("una plantilla que todavía no empezó es activa", () => {
    expect(recurringStatus(row({ start_date: "2027-03-01", end_date: "2027-12-31" }), "2026-10-15")).toBe("active");
  });
  it("sin fin nunca termina", () => {
    expect(recurringStatus(row({ end_date: null }), "2099-01-01")).toBe("active");
  });
});

describe("monthlyEquivalent (céntimos)", () => {
  const rowFor = (frequency: RecurringTemplateRow["frequency"], amount: unknown, weekly_interval: number | null = null) => ({ frequency, amount, weekly_interval });
  it("USD 10 semanal cada 1 semana = 4333", () => {
    expect(monthlyEquivalent(rowFor("weekly", 10, 1))).toBe(4333);
  });
  it("semanal cada 2 semanas divide por el intervalo", () => {
    expect(monthlyEquivalent(rowFor("weekly", 10, 2))).toBe(2167); // 2166,67
    expect(monthlyEquivalent(rowFor("weekly", 10, 4))).toBe(1083); // 1083,33
  });
  it("quincenal × 2, mensual × 1, anual / 12", () => {
    expect(monthlyEquivalent(rowFor("biweekly", 100))).toBe(20000);
    expect(monthlyEquivalent(rowFor("monthly", 36))).toBe(3600);
    expect(monthlyEquivalent(rowFor("yearly", 120))).toBe(1000);
    expect(monthlyEquivalent(rowFor("yearly", 100))).toBe(833); // 833,33
  });
  it("no arrastra flotantes: 0.1 + 0.2 y 416.67 × 3", () => {
    expect(monthlyEquivalent(rowFor("monthly", 0.1 + 0.2))).toBe(30);
    expect(monthlyEquivalent(rowFor("monthly", 416.67))).toBe(41667);
    expect(monthlyEquivalent(rowFor("biweekly", 416.67))).toBe(83334);
    expect(monthlyEquivalent(rowFor("yearly", 416.67 * 3))).toBe(10417); // 125001 / 12 = 10416,75
    expect(monthlyEquivalent(rowFor("monthly", "416.67"))).toBe(41667);
  });
  it("una variable sin estimado o un monto inválido vale 0", () => {
    expect(monthlyEquivalent(rowFor("monthly", null))).toBe(0);
    expect(monthlyEquivalent(rowFor("monthly", undefined))).toBe(0);
    expect(monthlyEquivalent(rowFor("monthly", "abc"))).toBe(0);
    expect(monthlyEquivalent(rowFor("monthly", -5))).toBe(0);
  });
  it("una variable con estimado sí cuenta", () => {
    expect(monthlyEquivalent(rowFor("monthly", 250))).toBe(25000);
  });
});

describe("describeFrequency", () => {
  it("las frases del plano", () => {
    expect(describeFrequency({ frequency: "monthly", monthlyDay: 5 })).toBe("Mensual, el día 5");
    expect(describeFrequency({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 2 })).toBe("Cada 2 semanas, los lunes");
    expect(describeFrequency({ frequency: "biweekly" })).toBe("Quincenal: 15 y último día");
    expect(describeFrequency({ frequency: "yearly", yearlyMonth: 3, yearlyDay: 15 })).toBe("Anual, el 15 de marzo");
  });
  it("semanal cada semana y los siete días", () => {
    expect(describeFrequency({ frequency: "weekly", weeklyDay: 0, weeklyInterval: 1 })).toBe("Semanal, los domingos");
    expect(describeFrequency({ frequency: "weekly", weeklyDay: 3, weeklyInterval: 3 })).toBe("Cada 3 semanas, los miércoles");
    expect(describeFrequency({ frequency: "weekly", weeklyDay: 6, weeklyInterval: 1 })).toBe("Semanal, los sábados");
  });
  it("aclara los días que no existen en todos los meses", () => {
    expect(describeFrequency({ frequency: "monthly", monthlyDay: 28 })).toBe("Mensual, el día 28");
    expect(describeFrequency({ frequency: "monthly", monthlyDay: 31 })).toBe("Mensual, el día 31 (o el último del mes)");
    expect(describeFrequency({ frequency: "yearly", yearlyMonth: 2, yearlyDay: 29 })).toBe("Anual, el 29 de febrero (el 28 en los años no bisiestos)");
  });
});

describe("ruleFromRow / templateForEngine", () => {
  it("arma la regla desde las columnas", () => {
    expect(ruleFromRow(row())).toEqual({ frequency: "monthly", monthlyDay: 5 });
    expect(ruleFromRow(row({ frequency: "weekly", weekly_day: 1, weekly_interval: 2, monthly_day: null }))).toEqual({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 2 });
    expect(ruleFromRow(row({ frequency: "biweekly", monthly_day: null }))).toEqual({ frequency: "biweekly" });
    expect(ruleFromRow(row({ frequency: "yearly", monthly_day: null, yearly_month: 3, yearly_day: 15 }))).toEqual({ frequency: "yearly", yearlyMonth: 3, yearlyDay: 15 });
  });
  it("una fila con columnas incompletas no tiene regla", () => {
    expect(ruleFromRow(row({ monthly_day: null }))).toBeNull();
    expect(templateForEngine(row({ monthly_day: null }))).toBeNull();
    expect(templateForEngine(row())).toEqual({ rule: { frequency: "monthly", monthlyDay: 5 }, startDate: "2026-01-01", endDate: null });
  });
});

describe("normalizeTemplate", () => {
  const TODAY = "2026-10-15";
  const ok = (r: ReturnType<typeof normalizeTemplate>) => {
    if (!r.ok) throw new Error(r.error);
    return r.row;
  };

  it("una fija mensual válida sale lista para insertar con generation_anchor = hoy", () => {
    expect(ok(normalizeTemplate(input(), TODAY))).toEqual({
      concept: "Google Workspace",
      vendor_id: null,
      category_key: "software",
      amount_type: "fixed",
      amount: 36,
      currency: "USD",
      charge_mode: "manual",
      frequency: "monthly",
      weekly_day: null,
      weekly_interval: null,
      monthly_day: 5,
      yearly_month: null,
      yearly_day: null,
      start_date: "2026-10-01",
      end_date: null,
      lead_days: 0,
      is_active: true,
      generation_anchor: TODAY,
      responsible_id: null,
      notes: null,
    });
  });

  it("una fija sin monto se rechaza (vacía, cero, texto, ausente)", () => {
    for (const amount of [undefined, null, "", "   ", 0, "0", "abc", -10]) {
      expect(normalizeTemplate(input({ amount }), TODAY).ok, `amount=${String(amount)}`).toBe(false);
    }
  });

  it("una variable sin monto se acepta y queda en null; con estimado lo guarda en céntimos exactos", () => {
    expect(ok(normalizeTemplate(input({ amountType: "variable", amount: undefined }), TODAY)).amount).toBeNull();
    expect(ok(normalizeTemplate(input({ amountType: "variable", amount: "" }), TODAY)).amount).toBeNull();
    expect(ok(normalizeTemplate(input({ amountType: "variable", amount: 0.1 + 0.2 }), TODAY)).amount).toBe(0.3);
    expect(ok(normalizeTemplate(input({ amountType: "variable", amount: "416.67" }), TODAY)).amount).toBe(416.67);
  });

  it("una variable con estimado cero o negativo se rechaza", () => {
    expect(normalizeTemplate(input({ amountType: "variable", amount: 0 }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ amountType: "variable", amount: -3 }), TODAY).ok).toBe(false);
  });

  it("con débito automático lead_days queda en 0 aunque el cliente mande otro valor", () => {
    expect(ok(normalizeTemplate(input({ chargeMode: "automatic", leadDays: 7 }), TODAY)).lead_days).toBe(0);
    expect(ok(normalizeTemplate(input({ chargeMode: "automatic", leadDays: 999 }), TODAY)).lead_days).toBe(0);
  });

  it("a mano admite anticipación de 0 a 60", () => {
    expect(ok(normalizeTemplate(input({ leadDays: 7 }), TODAY)).lead_days).toBe(7);
    expect(ok(normalizeTemplate(input({ leadDays: 60 }), TODAY)).lead_days).toBe(60);
    expect(ok(normalizeTemplate(input({ leadDays: undefined }), TODAY)).lead_days).toBe(0);
    expect(normalizeTemplate(input({ leadDays: 61 }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ leadDays: -1 }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ leadDays: 1.5 }), TODAY).ok).toBe(false);
  });

  it("la fecha de fin anterior al inicio se rechaza; igual al inicio se acepta", () => {
    const before = normalizeTemplate(input({ endDate: "2026-09-30" }), TODAY);
    expect(before).toEqual({ ok: false, error: "La fecha de fin no puede ser anterior al inicio" });
    expect(ok(normalizeTemplate(input({ endDate: "2026-10-01" }), TODAY)).end_date).toBe("2026-10-01");
    expect(ok(normalizeTemplate(input({ endDate: "" }), TODAY)).end_date).toBeNull();
  });

  it("fechas inexistentes se rechazan", () => {
    expect(normalizeTemplate(input({ startDate: "2026-02-30" }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ endDate: "2026-13-01" }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ startDate: undefined }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input(), "no-es-fecha").ok).toBe(false);
  });

  it("concepto: 1 a 200 caracteres, recortado", () => {
    expect(normalizeTemplate(input({ concept: "   " }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ concept: "x".repeat(201) }), TODAY).ok).toBe(false);
    expect(ok(normalizeTemplate(input({ concept: "x".repeat(200) }), TODAY)).concept).toHaveLength(200);
    expect(ok(normalizeTemplate(input({ concept: "  Contadora  " }), TODAY)).concept).toBe("Contadora");
  });

  it("categoría obligatoria y con forma de clave", () => {
    expect(normalizeTemplate(input({ categoryKey: undefined }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ categoryKey: "" }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ categoryKey: "Con Espacios" }), TODAY).ok).toBe(false);
  });

  it("cada frecuencia pide sus campos y nulifica los demás", () => {
    const weekly = ok(normalizeTemplate(input({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 2, monthlyDay: 5, yearlyMonth: 3, yearlyDay: 9 }), TODAY));
    expect(weekly).toMatchObject({ frequency: "weekly", weekly_day: 1, weekly_interval: 2, monthly_day: null, yearly_month: null, yearly_day: null });
    const biweekly = ok(normalizeTemplate(input({ frequency: "biweekly", monthlyDay: 5, weeklyDay: 1 }), TODAY));
    expect(biweekly).toMatchObject({ frequency: "biweekly", weekly_day: null, weekly_interval: null, monthly_day: null, yearly_month: null, yearly_day: null });
    const yearly = ok(normalizeTemplate(input({ frequency: "yearly", yearlyMonth: 2, yearlyDay: 29, monthlyDay: 5 }), TODAY));
    expect(yearly).toMatchObject({ frequency: "yearly", monthly_day: null, yearly_month: 2, yearly_day: 29 });

    expect(normalizeTemplate(input({ frequency: "weekly", monthlyDay: undefined, weeklyDay: 1 }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ frequency: "monthly", monthlyDay: undefined }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ frequency: "monthly", monthlyDay: 32 }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ frequency: "yearly", yearlyMonth: 4, yearlyDay: 31 }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ frequency: "weekly", weeklyDay: 1, weeklyInterval: 53 }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ frequency: "daily" }), TODAY).ok).toBe(false);
  });

  it("proveedor, responsable y notas vacíos son null; las notas tienen tope", () => {
    const r = ok(normalizeTemplate(input({ vendorId: "", responsibleId: "  ", notes: "   " }), TODAY));
    expect(r.vendor_id).toBeNull();
    expect(r.responsible_id).toBeNull();
    expect(r.notes).toBeNull();
    expect(ok(normalizeTemplate(input({ vendorId: "v-1", responsibleId: "u-1", notes: " pago con tarjeta " }), TODAY))).toMatchObject({ vendor_id: "v-1", responsible_id: "u-1", notes: "pago con tarjeta" });
    expect(normalizeTemplate(input({ notes: "x".repeat(2001) }), TODAY).ok).toBe(false);
  });

  it("el monto fijo se guarda en céntimos exactos y rechaza lo que no entra en numeric(12,2)", () => {
    expect(ok(normalizeTemplate(input({ amount: 416.67 * 3 }), TODAY)).amount).toBe(1250.01);
    expect(ok(normalizeTemplate(input({ amount: "0.1" }), TODAY)).amount).toBe(0.1);
    expect(normalizeTemplate(input({ amount: 1e12 }), TODAY).ok).toBe(false);
  });

  it("amountType, chargeMode y datos que no son un objeto se rechazan con mensaje", () => {
    expect(normalizeTemplate(input({ amountType: "otro" }), TODAY).ok).toBe(false);
    expect(normalizeTemplate(input({ chargeMode: "tarjeta" }), TODAY).ok).toBe(false);
    const r = normalizeTemplate(null, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});

describe("editResetsAnchor", () => {
  const base = { frequency: "monthly" as const, weekly_day: null, weekly_interval: null, monthly_day: 5, yearly_month: null, yearly_day: null, start_date: "2026-09-01", lead_days: 0 };
  it("cambiar el día, la frecuencia, el inicio o la anticipación reinicia el anclaje", () => {
    expect(editResetsAnchor(base, { ...base, monthly_day: 10 })).toBe(true);
    expect(editResetsAnchor(base, { ...base, frequency: "biweekly", monthly_day: null })).toBe(true);
    expect(editResetsAnchor(base, { ...base, start_date: "2026-10-01" })).toBe(true);
    expect(editResetsAnchor(base, { ...base, lead_days: 7 })).toBe(true);
  });
  it("no cambiar nada de fechas no lo reinicia", () => {
    expect(editResetsAnchor(base, { ...base })).toBe(false);
  });
});

describe("missedDatesOnReactivate", () => {
  const monthly5 = { frequency: "monthly" as const, weekly_day: null, weekly_interval: null, monthly_day: 5, yearly_month: null, yearly_day: null, start_date: "2026-01-01", end_date: null, lead_days: 0, charge_mode: "manual" as const };
  it("lista las fechas de pago que cayeron mientras estuvo pausada, hasta ayer", () => {
    expect(missedDatesOnReactivate(monthly5, "2026-09-20", "2026-11-10")).toEqual(["2026-10-05", "2026-11-05"]);
  });
  it("si se pausó hoy o después de ayer no hay nada", () => {
    expect(missedDatesOnReactivate(monthly5, "2026-11-10", "2026-11-10")).toEqual([]);
  });
  it("no mira más de 62 días hacia atrás", () => {
    expect(missedDatesOnReactivate(monthly5, "2026-01-01", "2026-11-10")).toEqual(["2026-10-05", "2026-11-05"]);
  });
  it("una regla inválida no devuelve nada", () => {
    expect(missedDatesOnReactivate({ ...monthly5, monthly_day: null }, "2026-09-20", "2026-11-10")).toEqual([]);
  });
});
