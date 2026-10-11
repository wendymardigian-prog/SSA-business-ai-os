import { describe, expect, it } from "vitest";
import { checkRows, defaultStep3, paymentsForServer, planFromState } from "./step3";

const ctx = { saleDate: "2026-10-01", today: "2026-10-11", enabledMethods: ["wise", "binance"] };

describe("paso 3 del asistente", () => {
  it("pago completo: un solo pago por el final, cobrado hoy por defecto", () => {
    const plan = planFromState(1297, defaultStep3("2026-10-11", "full"));
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ type: "full", amount: 1297, status: "paid", due_date: "2026-10-11" });
  });

  it("cuotas: primer pago + resto repartido, la última absorbe el redondeo", () => {
    const s = { ...defaultStep3("2026-10-11", "installments"), firstAmount: "0", installments: "3", firstDue: "2026-11-01" };
    const plan = planFromState(1250, s);
    expect(plan.map((p) => p.amount)).toEqual([416.67, 416.67, 416.66]);
    expect(plan.map((p) => p.due_date)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });

  it("un cobrado necesita método habilitado y fecha entre la venta y hoy", () => {
    const rows = planFromState(100, { ...defaultStep3("2026-10-11", "full"), firstMethod: "paypal" });
    expect(checkRows(rows, ctx).errors[0]).toMatch(/Elegí el método|no está habilitado/);
    const ok = planFromState(100, { ...defaultStep3("2026-10-11", "full"), firstMethod: "wise" });
    expect(checkRows(ok, ctx).errors).toEqual([]);
    const early = planFromState(100, { ...defaultStep3("2026-09-01", "full"), firstMethod: "wise" });
    expect(checkRows(early, ctx).errors.join()).toMatch(/antes de la fecha de la venta/);
  });

  it("una cuota con fecha pasada avisa «nace morosa» sin bloquear", () => {
    const s = { ...defaultStep3("2026-10-11", "installments"), firstAmount: "0", installments: "2", firstDue: "2026-09-20" };
    const check = checkRows(planFromState(200, s), ctx);
    expect(check.errors).toEqual([]);
    expect(check.bornOverdue).toEqual([0, 1].filter((i) => i === 0));
  });

  it("paymentsForServer manda la fecha efectiva o el vencimiento", () => {
    const rows = planFromState(100, { ...defaultStep3("2026-10-11", "full"), firstMethod: "wise" });
    expect(paymentsForServer(rows)).toEqual([{ type: "full", amount: 100, status: "paid", date: "2026-10-11", method: "wise" }]);
  });
});
