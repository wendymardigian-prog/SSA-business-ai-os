import { describe, expect, it } from "vitest";
import { groupByPerson, isPayable, payoutConcept, planPayout, selectableReason, selectableReasonCode, selectionTotals, summarizeSelection, type SelectedCommission } from "./selection";
import type { CommissionExpenseRef, CommissionStatusInput } from "./status";

const TODAY = "2026-10-15";
const ANA = "a0000000-0000-4000-8000-000000000001";
const JUAN = "a0000000-0000-4000-8000-000000000002";
const base: CommissionStatusInput = { voided_at: null, user_id: ANA, expense_id: null, available_on: TODAY };
const exp = (status: string): CommissionExpenseRef => ({ status, scheduled_date: "2026-11-05", paid_date: status === "pagado" ? "2026-11-06" : null });
const sel = (id: string, userId: string | null, amountCents: number, paidOn: string | null = "2026-10-10"): SelectedCommission => ({ id, userId, amountCents, paidOn });

describe("selectableReason", () => {
  it("una pendiente con persona se puede seleccionar (también una que resta)", () => {
    expect(selectableReason(base, null, TODAY)).toBeNull();
    expect(selectableReasonCode({ ...base, available_on: "2026-09-01" }, null, TODAY)).toBeNull();
  });
  it("anulada", () => {
    expect(selectableReasonCode({ ...base, voided_at: "2026-10-01T00:00:00Z" }, null, TODAY)).toBe("voided");
    expect(selectableReason({ ...base, voided_at: "2026-10-01T00:00:00Z" }, null, TODAY)).toBe("Está anulada");
  });
  it("ya en un gasto (programado o pagado)", () => {
    expect(selectableReasonCode({ ...base, expense_id: "e1" }, exp("programado"), TODAY)).toBe("already_in_expense");
    expect(selectableReasonCode({ ...base, expense_id: "e1" }, exp("pagado"), TODAY)).toBe("already_in_expense");
    expect(selectableReason({ ...base, expense_id: "e1" }, exp("vencido"), TODAY)).toBe("Ya está en un gasto");
  });
  it("sin persona", () => {
    expect(selectableReasonCode({ ...base, user_id: null }, null, TODAY)).toBe("no_person");
  });
  it("retenida", () => {
    expect(selectableReasonCode({ ...base, available_on: "2026-10-16" }, null, TODAY)).toBe("held");
    expect(selectableReason({ ...base, available_on: "2026-10-16" }, null, TODAY)).toMatch(/retenida/);
  });
  it("un gasto anulado suelta la comisión: vuelve a ser seleccionable", () => {
    expect(selectableReason({ ...base, expense_id: "e1" }, exp("anulado"), TODAY)).toBeNull();
  });
});

describe("summarizeSelection", () => {
  it("el ejemplo del plano", () => {
    const list = [...Array.from({ length: 10 }, (_, i) => sel(`a${i}`, ANA, 10000)), ...Array.from({ length: 4 }, (_, i) => sel(`j${i}`, JUAN, 6000))];
    expect(summarizeSelection(list)).toBe("14 comisiones · USD 1.240,00 · 2 personas");
  });
  it("singular y vacío", () => {
    expect(summarizeSelection([sel("a", ANA, 1000)])).toBe("1 comisión · USD 10,00 · 1 persona");
    expect(summarizeSelection([])).toBe("0 comisiones · USD 0,00 · 0 personas");
  });
  it("un ajuste negativo resta", () => {
    expect(selectionTotals([sel("a", ANA, 5000), sel("b", ANA, -1000)])).toEqual({ count: 2, cents: 4000, people: 1 });
  });
});

describe("groupByPerson / planPayout", () => {
  const selected = [sel("a1", ANA, 5000), sel("j1", JUAN, 2500), sel("a2", ANA, 3000), sel("a3", ANA, -1000), sel("j2", JUAN, 2500)];

  it("agrupa por persona en el orden de aparición", () => {
    const groups = groupByPerson(selected);
    expect(groups.map((g) => [g.userId, g.count, g.totalCents])).toEqual([[ANA, 3, 7000], [JUAN, 2, 5000]]);
    expect(groups[0].commissions.map((c) => c.id)).toEqual(["a1", "a2", "a3"]);
  });
  it("las sin persona quedan afuera", () => {
    expect(groupByPerson([sel("x", null, 100)])).toEqual([]);
  });
  it("Ana +50 +30 −10 = 70,00 y Juan +25 +25 = 50,00 → dos gastos", () => {
    const plan = planPayout(selected, "per_person");
    expect(plan).toHaveLength(2);
    expect(plan.map((g) => [g.userId, g.totalCents, g.payable, g.reason])).toEqual([[ANA, 7000, true, null], [JUAN, 5000, true, null]]);
    expect(plan[0].commissionIds).toEqual(["a1", "a2", "a3"]);
  });
  it("Ana +10 −30 queda excluida: el total es negativo", () => {
    const plan = planPayout([sel("a1", ANA, 1000), sel("a2", ANA, -3000), sel("j1", JUAN, 2500)], "per_person");
    expect(plan.find((g) => g.userId === ANA)).toMatchObject({ totalCents: -2000, payable: false, reason: "non_positive_total" });
    expect(plan.find((g) => g.userId === JUAN)?.payable).toBe(true);
  });
  it("un total de exactamente cero tampoco se genera", () => {
    expect(planPayout([sel("a1", ANA, 1000), sel("a2", ANA, -1000)], "per_person")[0]).toMatchObject({ totalCents: 0, payable: false });
  });
  it("modo un solo gasto: todo junto, sin persona", () => {
    const plan = planPayout(selected, "single");
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ userId: null, count: 5, totalCents: 12000, payable: true });
    expect(planPayout([], "single")).toEqual([]);
  });
});

describe("isPayable", () => {
  it("solo un total mayor que cero", () => {
    expect(isPayable(1)).toBe(true);
    expect(isPayable(0)).toBe(false);
    expect(isPayable(-100)).toBe(false);
    expect(isPayable(Number.NaN)).toBe(false);
  });
});

describe("payoutConcept", () => {
  it("un mes: el del cobro", () => {
    expect(payoutConcept("Ana", [{ paidOn: "2026-10-03" }, { paidOn: "2026-10-28" }])).toBe("Comisiones de Ana · octubre 2026");
    expect(payoutConcept({ name: "Ana" }, [{ paidOn: "2026-10-03" }])).toBe("Comisiones de Ana · octubre 2026");
  });
  it("varios meses del mismo año: sep–oct 2026", () => {
    expect(payoutConcept("Ana", [{ paidOn: "2026-10-03" }, { paidOn: "2026-09-28" }])).toBe("Comisiones de Ana · sep–oct 2026");
    expect(payoutConcept("Ana", [{ paidOn: "2026-08-03" }, { paidOn: "2026-10-28" }, { paidOn: "2026-09-01" }])).toBe("Comisiones de Ana · ago–oct 2026");
  });
  it("varios meses de años distintos", () => {
    expect(payoutConcept("Ana", [{ paidOn: "2025-12-20" }, { paidOn: "2026-01-05" }])).toBe("Comisiones de Ana · dic 2025–ene 2026");
  });
  it("modo un solo gasto (sin persona) y sin fechas", () => {
    expect(payoutConcept(null, [{ paidOn: "2026-10-03" }])).toBe("Comisiones del equipo · octubre 2026");
    expect(payoutConcept("Ana", [])).toBe("Comisiones de Ana");
    expect(payoutConcept("Ana", [{ paidOn: null }])).toBe("Comisiones de Ana");
  });
});
