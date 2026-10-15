import { describe, expect, it } from "vitest";
import { COMMISSION_STATUS_KEYS, COMMISSION_STATUSES, commissionStatus, commissionStatusLabel, shortCivil, type CommissionExpenseRef, type CommissionStatusInput } from "./status";

const TODAY = "2026-10-15";
const base: CommissionStatusInput = { voided_at: null, user_id: "u1", expense_id: null, available_on: "2026-10-15" };
const exp = (patch: Partial<CommissionExpenseRef> = {}): CommissionExpenseRef => ({ status: "programado", scheduled_date: "2026-11-05", paid_date: null, ...patch });

describe("commissionStatus: los seis estados", () => {
  it("Anulada", () => {
    expect(commissionStatus({ ...base, voided_at: "2026-10-16T00:00:00Z" }, null, TODAY)).toMatchObject({ key: "anulada", label: "Anulada", tone: "gray" });
  });
  it("Sin persona", () => {
    expect(commissionStatus({ ...base, user_id: null }, null, TODAY)).toMatchObject({ key: "sin_persona", label: "Sin persona" });
  });
  it("Pagada, con la fecha de pago", () => {
    const r = commissionStatus({ ...base, expense_id: "e1" }, exp({ status: "pagado", paid_date: "2026-11-06" }), TODAY);
    expect(r).toMatchObject({ key: "pagada", date: "2026-11-06", detail: "Pagada 6/11", tone: "green" });
  });
  it("En gasto, con la fecha y el estado del gasto", () => {
    expect(commissionStatus({ ...base, expense_id: "e1" }, exp(), TODAY)).toMatchObject({ key: "en_gasto", date: "2026-11-05", expenseStatus: "programado", detail: "Programado 5/11" });
    expect(commissionStatus({ ...base, expense_id: "e1" }, exp({ status: "vencido" }), TODAY)).toMatchObject({ key: "en_gasto", expenseStatus: "vencido", detail: "Vencido 5/11" });
    expect(commissionStatus({ ...base, expense_id: "e1" }, exp({ status: "por_revisar", scheduled_date: null }), TODAY)).toMatchObject({ key: "en_gasto", expenseStatus: "por_revisar", detail: "Por revisar" });
  });
  it("Retenida, hasta la fecha", () => {
    expect(commissionStatus({ ...base, available_on: "2026-11-05" }, null, TODAY)).toMatchObject({ key: "retenida", date: "2026-11-05", detail: "Hasta el 5/11" });
  });
  it("Pendiente (disponible hoy cuenta como disponible)", () => {
    expect(commissionStatus(base, null, TODAY)).toMatchObject({ key: "pendiente", label: "Pendiente", date: null, detail: "" });
    expect(commissionStatus({ ...base, available_on: "2026-09-01" }, null, TODAY).key).toBe("pendiente");
  });
});

describe("commissionStatus: precedencia", () => {
  it("anulada gana sobre todo", () => {
    expect(commissionStatus({ ...base, voided_at: "x", user_id: null, expense_id: "e1", available_on: "2027-01-01" }, exp({ status: "pagado", paid_date: "2026-11-06" }), TODAY).key).toBe("anulada");
  });
  it("sin persona gana sobre el gasto y la retención", () => {
    expect(commissionStatus({ ...base, user_id: null, expense_id: "e1", available_on: "2027-01-01" }, exp(), TODAY).key).toBe("sin_persona");
  });
  it("el gasto gana sobre la retención", () => {
    expect(commissionStatus({ ...base, expense_id: "e1", available_on: "2027-01-01" }, exp(), TODAY).key).toBe("en_gasto");
  });
});

describe("commissionStatus: bordes", () => {
  it("un gasto anulado no cuenta: se evalúa como sin gasto", () => {
    expect(commissionStatus({ ...base, expense_id: "e1" }, exp({ status: "anulado" }), TODAY).key).toBe("pendiente");
    expect(commissionStatus({ ...base, expense_id: "e1", available_on: "2026-12-01" }, exp({ status: "anulado" }), TODAY).key).toBe("retenida");
  });
  it("con expense_id pero sin el gasto cargado sigue en gasto, sin fecha", () => {
    expect(commissionStatus({ ...base, expense_id: "e1" }, null, TODAY)).toMatchObject({ key: "en_gasto", date: null, expenseStatus: null });
  });
  it("pagada sin fecha de pago no inventa una", () => {
    expect(commissionStatus({ ...base, expense_id: "e1" }, exp({ status: "pagado", paid_date: null }), TODAY)).toMatchObject({ key: "pagada", date: null, detail: "Pagada" });
  });
});

describe("COMMISSION_STATUSES", () => {
  it("tiene una entrada con etiqueta y tono por cada estado", () => {
    expect([...COMMISSION_STATUS_KEYS].sort()).toEqual(Object.keys(COMMISSION_STATUSES).sort());
    for (const k of COMMISSION_STATUS_KEYS) {
      expect(COMMISSION_STATUSES[k].label).toBeTruthy();
      expect(COMMISSION_STATUSES[k].tone).toBeTruthy();
    }
  });
  it("commissionStatusLabel", () => {
    expect(commissionStatusLabel("en_gasto")).toBe("En gasto");
    expect(commissionStatusLabel("raro")).toBe("raro");
  });
  it("shortCivil", () => {
    expect(shortCivil("2026-11-05")).toBe("5/11");
    expect(shortCivil("2026-01-31")).toBe("31/1");
  });
});
