import { describe, expect, it } from "vitest";
import { GENERATION_LOOKBACK_DAYS, MAX_GENERATED_PER_RUN, buildRecurringExpense, datesToGenerate, type RecurringExpenseRow, type RecurringTemplateForGeneration } from "./generate-recurring";

const template = (over: Partial<RecurringTemplateForGeneration> = {}): RecurringTemplateForGeneration => ({
  id: "rec-1",
  concept: "Google Workspace",
  vendor_id: "vendor-google",
  category_key: "software",
  amount_type: "fixed",
  amount: 36,
  charge_mode: "automatic",
  frequency: "monthly",
  weekly_day: null,
  weekly_interval: null,
  monthly_day: 5,
  yearly_month: null,
  yearly_day: null,
  start_date: "2026-01-01",
  end_date: null,
  lead_days: 0,
  generation_anchor: "2026-10-01",
  responsible_id: "user-1",
  notes: "Plan Business",
  ...over,
});

/** Lo que haría el handler: las fechas del día, convertidas en filas. */
const runDay = (t: RecurringTemplateForGeneration, today: string): RecurringExpenseRow[] => datesToGenerate(t, today).map((d) => buildRecurringExpense(t, d, today));

describe("buildRecurringExpense: la tabla de estados al nacer", () => {
  it("variable (a mano o automática): Por revisar, monto 0, sin fecha de pago", () => {
    for (const charge_mode of ["manual", "automatic"] as const) {
      const row = buildRecurringExpense(template({ amount_type: "variable", amount: null, charge_mode }), "2026-10-10", "2026-10-03");
      expect(row).toMatchObject({ status: "por_revisar", amount: 0, paid_date: null, scheduled_date: "2026-10-10" });
    }
  });
  it("variable con un monto estimado: igual nace en 0 (el estimado solo sirve para el total mensual)", () => {
    const row = buildRecurringExpense(template({ amount_type: "variable", amount: 250 }), "2026-10-10", "2026-10-10");
    expect(row.amount).toBe(0);
    expect(row.status).toBe("por_revisar");
  });
  it("fija + débito automático: Pagado, con paid_date = la fecha programada y el monto de la plantilla", () => {
    const row = buildRecurringExpense(template(), "2026-10-05", "2026-10-05");
    expect(row).toMatchObject({ status: "pagado", paid_date: "2026-10-05", amount: 36 });
  });
  it("fija + débito automático que se pone al día: paid_date sigue siendo la fecha programada, no hoy", () => {
    const row = buildRecurringExpense(template(), "2026-10-05", "2026-10-09");
    expect(row).toMatchObject({ status: "pagado", paid_date: "2026-10-05" });
  });
  it("fija + a mano: programado si la fecha es hoy o futura; vencido si ya pasó (se pone al día)", () => {
    const manual = template({ charge_mode: "manual" });
    expect(buildRecurringExpense(manual, "2026-10-10", "2026-10-03")).toMatchObject({ status: "programado", paid_date: null, amount: 36 });
    expect(buildRecurringExpense(manual, "2026-10-10", "2026-10-10")).toMatchObject({ status: "programado", paid_date: null });
    expect(buildRecurringExpense(manual, "2026-10-05", "2026-10-10")).toMatchObject({ status: "vencido", paid_date: null });
  });
  it("un débito automático con fecha futura no se marca pagado (no se paga a futuro)", () => {
    const row = buildRecurringExpense(template(), "2026-10-10", "2026-10-03");
    expect(row).toMatchObject({ status: "programado", paid_date: null, amount: 36 });
  });
  it("copia concepto, proveedor, categoría, responsable y notas de la plantilla; origen y vínculo", () => {
    const row = buildRecurringExpense(template(), "2026-10-05", "2026-10-05");
    expect(row).toEqual({
      concept: "Google Workspace",
      vendor_id: "vendor-google",
      category_key: "software",
      amount: 36,
      status: "pagado",
      scheduled_date: "2026-10-05",
      paid_date: "2026-10-05",
      origin: "recurring",
      recurring_expense_id: "rec-1",
      responsible_id: "user-1",
      notes: "Plan Business",
      created_by: null,
    });
  });
  it("es un snapshot: cambiar la plantilla después no cambia la fila ya armada", () => {
    const t = template();
    const row = buildRecurringExpense(t, "2026-10-05", "2026-10-05");
    t.amount = 99;
    t.concept = "Otro";
    expect(row.amount).toBe(36);
    expect(row.concept).toBe("Google Workspace");
  });
  it("el monto de la plantilla pasa por céntimos: sin restos de flotante", () => {
    expect(buildRecurringExpense(template({ amount: 0.1 + 0.2 }), "2026-10-05", "2026-10-05").amount).toBe(0.3);
    expect(buildRecurringExpense(template({ amount: 416.67 * 3 }), "2026-10-05", "2026-10-05").amount).toBe(1250.01);
    expect(buildRecurringExpense(template({ amount: "416.67" }), "2026-10-05", "2026-10-05").amount).toBe(416.67);
  });
});

describe("datesToGenerate: el día del trabajo", () => {
  it("«Google Workspace» fija USD 36, mensual día 5, débito automático: el 2026-10-05 genera un pagado; el 10-04, nada", () => {
    expect(runDay(template(), "2026-10-05")).toEqual([expect.objectContaining({ status: "pagado", amount: 36, paid_date: "2026-10-05", scheduled_date: "2026-10-05" })]);
    expect(runDay(template(), "2026-10-04")).toEqual([]);
  });

  it("«Contadora» variable, mensual día 10, a mano, anticipación 7: el 2026-10-03 genera un por_revisar para el 2026-10-10", () => {
    const contadora = template({ concept: "Contadora", amount_type: "variable", amount: null, charge_mode: "manual", monthly_day: 10, lead_days: 7 });
    expect(runDay(contadora, "2026-10-03")).toEqual([expect.objectContaining({ status: "por_revisar", amount: 0, scheduled_date: "2026-10-10", paid_date: null })]);
    expect(runDay(contadora, "2026-10-02")).toEqual([]);
  });

  it("con débito automático la anticipación es 0 aunque la fila traiga otro valor", () => {
    const t = template({ charge_mode: "automatic", lead_days: 7 });
    expect(datesToGenerate(t, "2026-10-04")).toEqual([]);
    expect(datesToGenerate(t, "2026-10-05")).toEqual(["2026-10-05"]);
  });

  it("idempotente: correr dos veces el mismo día y un índice único (simulado) dejan un solo gasto", () => {
    const t = template({ charge_mode: "manual", monthly_day: 10, lead_days: 7 });
    const table = new Map<string, RecurringExpenseRow>(); // clave del índice único (recurring_expense_id, scheduled_date)
    const insertDoNothing = (row: RecurringExpenseRow) => {
      const key = `${row.recurring_expense_id}|${row.scheduled_date}`;
      if (!table.has(key)) table.set(key, row);
    };
    runDay(t, "2026-10-03").forEach(insertDoNothing);
    runDay(t, "2026-10-03").forEach(insertDoNothing);
    runDay(t, "2026-10-04").forEach(insertDoNothing);
    expect(table.size).toBe(1);
  });

  it("un gasto anulado ocupa su fecha: el motor la propone de nuevo y es el índice el que la descarta", () => {
    const t = template({ charge_mode: "manual" });
    const first = datesToGenerate(t, "2026-10-05");
    const second = datesToGenerate(t, "2026-10-06");
    expect(first).toEqual(["2026-10-05"]);
    expect(second).toEqual(["2026-10-05"]);
  });

  it("pausada en marzo y reactivada el 2026-05-10 (ancla = hoy): no crea los de abril ni el del 5/05", () => {
    const t = template({ generation_anchor: "2026-05-10", start_date: "2026-01-01" });
    expect(datesToGenerate(t, "2026-05-10")).toEqual([]);
    expect(datesToGenerate(t, "2026-06-04")).toEqual([]);
    expect(datesToGenerate(t, "2026-06-05")).toEqual(["2026-06-05"]);
  });

  it("editada hoy (cambió del día 5 al 3, hoy es 4, ancla = hoy): no crea el del 3 de este mes", () => {
    const t = template({ monthly_day: 3, generation_anchor: "2026-10-04" });
    expect(datesToGenerate(t, "2026-10-04")).toEqual([]);
    expect(datesToGenerate(t, "2026-11-03")).toEqual(["2026-11-03"]);
  });

  it("mira como mucho 62 días hacia atrás aunque el ancla sea más vieja", () => {
    expect(GENERATION_LOOKBACK_DAYS).toBe(62);
    const t = template({ charge_mode: "manual", generation_anchor: "2026-01-01" });
    // hoy 2026-10-15 − 62 días = 2026-08-14: entran 09-05 y 10-05, no 08-05.
    expect(datesToGenerate(t, "2026-10-15")).toEqual(["2026-09-05", "2026-10-05"]);
  });

  it("no genera antes del inicio de la plantilla", () => {
    const t = template({ start_date: "2026-10-12", generation_anchor: "2026-09-01" });
    expect(datesToGenerate(t, "2026-11-04")).toEqual([]);
    expect(datesToGenerate(t, "2026-11-05")).toEqual(["2026-11-05"]);
  });

  it("no genera después de la fecha de fin (contra la fecha de PAGO)", () => {
    const t = template({ charge_mode: "manual", monthly_day: 10, lead_days: 7, end_date: "2026-10-03", generation_anchor: "2026-09-20" });
    expect(datesToGenerate(t, "2026-10-03")).toEqual([]);
  });

  it("semanal: respeta la cadencia original aunque el ancla sea posterior", () => {
    // Lunes cada 2 semanas desde 2026-12-21; reactivada el 2027-01-05.
    const t = template({ frequency: "weekly", monthly_day: null, weekly_day: 1, weekly_interval: 2, start_date: "2026-12-21", generation_anchor: "2027-01-05" });
    expect(datesToGenerate(t, "2027-01-17")).toEqual([]);
    expect(datesToGenerate(t, "2027-01-18")).toEqual(["2027-01-18"]);
  });

  it("se pone al día: varias fechas atrasadas dentro de la ventana, en orden", () => {
    const t = template({ charge_mode: "manual", frequency: "biweekly", monthly_day: null, generation_anchor: "2026-09-01" });
    expect(datesToGenerate(t, "2026-10-20")).toEqual(["2026-09-15", "2026-09-30", "2026-10-15"]);
    const rows = runDay(t, "2026-10-20");
    expect(rows.map((r) => r.status)).toEqual(["vencido", "vencido", "vencido"]);
  });

  it("una fila con una regla inválida no genera nada", () => {
    expect(datesToGenerate(template({ monthly_day: null }), "2026-10-05")).toEqual([]);
  });

  it("el tope por corrida es de 500", () => {
    expect(MAX_GENERATED_PER_RUN).toBe(500);
  });
});
