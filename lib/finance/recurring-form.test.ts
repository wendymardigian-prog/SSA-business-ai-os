import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES } from "./categories";
import { buildRecurringInput, defaultRecurringCategory, draftFromRow, emptyRecurringDraft, previewPaymentDates, recurringDraftError, type RecurringDraft } from "./recurring-form";
import { normalizeTemplate, type RecurringTemplateRow } from "./recurring";

const TODAY = "2026-10-15";
const draft = (over: Partial<RecurringDraft> = {}): RecurringDraft => ({ ...emptyRecurringDraft(TODAY, DEFAULT_EXPENSE_CATEGORIES), concept: "Zoom", amountText: "16,99", ...over });

describe("emptyRecurringDraft", () => {
  it("arranca mensual, a mano, con el día de hoy y «Software» como categoría", () => {
    const d = emptyRecurringDraft(TODAY, DEFAULT_EXPENSE_CATEGORIES);
    expect(d).toMatchObject({ frequency: "monthly", chargeMode: "manual", monthlyDay: "15", startDate: TODAY, categoryKey: "software", amountType: "fixed", yearlyMonth: 10, weeklyDay: 4 });
  });

  it("sin «Software» activa usa la primera activa", () => {
    const cats = DEFAULT_EXPENSE_CATEGORIES.map((c) => (c.key === "software" ? { ...c, archived_at: "2026-01-01T00:00:00Z" } : c));
    expect(defaultRecurringCategory(cats)).toBe("ads_meta");
  });
});

describe("buildRecurringInput / recurringDraftError", () => {
  it("un borrador válido pasa la misma validación que usa el servidor", () => {
    const built = buildRecurringInput(draft());
    expect(built.ok).toBe(true);
    if (built.ok) expect(normalizeTemplate(built.input, TODAY)).toMatchObject({ ok: true, row: { amount: 16.99, frequency: "monthly", monthly_day: 15 } });
    expect(recurringDraftError(draft(), TODAY)).toBeNull();
  });

  it("entiende los montos como los escribe la gente", () => {
    const built = buildRecurringInput(draft({ amountText: "1.240,50" }));
    expect(built.ok && built.input.amount).toBe(1240.5);
  });

  it("un monto ilegible o un fijo sin monto dan un mensaje claro", () => {
    expect(recurringDraftError(draft({ amountText: "abc" }), TODAY)).toMatch(/números/);
    expect(recurringDraftError(draft({ amountText: "" }), TODAY)).toMatch(/monto mayor que cero/);
  });

  it("variable puede ir sin monto", () => {
    expect(recurringDraftError(draft({ amountType: "variable", amountText: "" }), TODAY)).toBeNull();
  });

  it("concepto vacío, día imposible y fin anterior al inicio", () => {
    expect(recurringDraftError(draft({ concept: " " }), TODAY)).toMatch(/concepto/i);
    expect(recurringDraftError(draft({ monthlyDay: "32" }), TODAY)).toMatch(/1 a 31/);
    expect(recurringDraftError(draft({ monthlyDay: "" }), TODAY)).not.toBeNull();
    expect(recurringDraftError(draft({ endDate: "2026-01-01" }), TODAY)).toMatch(/anterior/);
  });

  it("con débito automático la anticipación viaja en 0 aunque el campo tenga otra cosa", () => {
    const built = buildRecurringInput(draft({ chargeMode: "automatic", leadDays: "9" }));
    expect(built.ok && built.input.leadDays).toBe(0);
  });

  it("a mano, la anticipación va de 0 a 60", () => {
    expect(recurringDraftError(draft({ leadDays: "61" }), TODAY)).toMatch(/0 a 60/);
    expect(recurringDraftError(draft({ leadDays: "5" }), TODAY)).toBeNull();
  });

  it("los campos de otra frecuencia no viajan", () => {
    const built = buildRecurringInput(draft({ frequency: "biweekly" }));
    expect(built.ok && built.input).toMatchObject({ weeklyDay: null, monthlyDay: null, yearlyMonth: null, yearlyDay: null });
  });
});

describe("previewPaymentDates", () => {
  it("mensual: las próximas tres fechas, empezando hoy si cae hoy", () => {
    expect(previewPaymentDates(draft({ monthlyDay: "15" }), TODAY).map((p) => p.date)).toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
  });

  it("quincenal: 15 y último día", () => {
    expect(previewPaymentDates(draft({ frequency: "biweekly" }), TODAY).map((p) => p.date)).toEqual(["2026-10-15", "2026-10-31", "2026-11-15"]);
  });

  it("semanal cada 2 semanas respeta la cadencia desde el inicio", () => {
    const d = draft({ frequency: "weekly", weeklyDay: 1, weeklyInterval: "2", startDate: "2026-10-05" });
    expect(previewPaymentDates(d, TODAY).map((p) => p.date)).toEqual(["2026-10-19", "2026-11-02", "2026-11-16"]);
  });

  it("anual: una sola fecha por año", () => {
    const d = draft({ frequency: "yearly", yearlyMonth: 3, yearlyDay: "1" });
    expect(previewPaymentDates(d, TODAY).map((p) => p.date)).toEqual(["2027-03-01", "2028-03-01", "2029-03-01"]);
  });

  it("con fecha de fin muestra solo las que quedan", () => {
    expect(previewPaymentDates(draft({ monthlyDay: "20", endDate: "2026-11-30" }), TODAY).map((p) => p.date)).toEqual(["2026-10-20", "2026-11-20"]);
  });

  it("a mano con anticipación dice cuándo se crea el gasto; con débito automático no", () => {
    expect(previewPaymentDates(draft({ monthlyDay: "20", leadDays: "5" }), TODAY, 1)[0]).toEqual({ date: "2026-10-20", createdOn: "2026-10-15" });
    expect(previewPaymentDates(draft({ monthlyDay: "20", leadDays: "5", chargeMode: "automatic" }), TODAY, 1)[0].createdOn).toBeNull();
  });

  it("un borrador incompleto no muestra nada", () => {
    expect(previewPaymentDates(draft({ monthlyDay: "" }), TODAY)).toEqual([]);
    expect(previewPaymentDates(draft({ startDate: "" }), TODAY)).toEqual([]);
  });
});

describe("draftFromRow", () => {
  const row: RecurringTemplateRow = {
    concept: "Alquiler", vendor_id: "v1", category_key: "admin_team", amount_type: "fixed", amount: 500, charge_mode: "automatic", frequency: "yearly",
    weekly_day: null, weekly_interval: null, monthly_day: null, yearly_month: 3, yearly_day: 9, start_date: "2026-01-01", end_date: "2027-01-01",
    lead_days: 0, is_active: true, generation_anchor: "2026-01-01", responsible_id: "u1", notes: "hola",
  };

  it("ida y vuelta: editar sin tocar nada da la misma regla", () => {
    const d = draftFromRow(row, "r1", "2026-10-01T00:00:00Z");
    expect(d).toMatchObject({ id: "r1", updatedAt: "2026-10-01T00:00:00Z", amountText: "500,00", yearlyMonth: 3, yearlyDay: "9", endDate: "2027-01-01", notes: "hola" });
    const built = buildRecurringInput(d);
    expect(built.ok && normalizeTemplate(built.input, TODAY)).toMatchObject({ ok: true, row: { frequency: "yearly", yearly_month: 3, yearly_day: 9, amount: 500, end_date: "2027-01-01" } });
  });

  it("un monto variable sin estimado queda vacío", () => {
    expect(draftFromRow({ ...row, amount_type: "variable", amount: null }, "r1", "x").amountText).toBe("");
  });
});
