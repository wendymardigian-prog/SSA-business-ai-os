import { describe, expect, it } from "vitest";
import { calcLabel, expenseCellText, paymentLabel, paymentPositions, type NumberablePayment } from "./row-labels";
import { commissionStatus } from "./status";

const pay = (id: string, patch: Partial<NumberablePayment> = {}): NumberablePayment => ({
  id, sale_id: "s1", type: "installment", status: "paid", original_due_date: null, due_date: "2026-10-01", created_at: "2026-09-01T00:00:00Z", ...patch,
});

describe("paymentPositions", () => {
  it("numera por vencimiento y cuenta los pagos de la venta", () => {
    const map = paymentPositions([pay("c", { due_date: "2026-12-01" }), pay("a", { due_date: "2026-10-01" }), pay("b", { due_date: "2026-11-01" })]);
    expect(map.get("a")).toEqual({ number: 1, total: 3 });
    expect(map.get("b")).toEqual({ number: 2, total: 3 });
    expect(map.get("c")).toEqual({ number: 3, total: 3 });
  });

  it("usa el vencimiento ORIGINAL si el pago se reprogramó (igual que la regla en SQL)", () => {
    const map = paymentPositions([pay("a", { original_due_date: "2026-10-01", due_date: "2026-12-20" }), pay("b", { due_date: "2026-11-01" })]);
    expect(map.get("a")?.number).toBe(1);
    expect(map.get("b")?.number).toBe(2);
  });

  it("los sin fecha van al final y el empate lo resuelve el alta y después el id", () => {
    const map = paymentPositions([
      pay("sin", { due_date: null, original_due_date: null }),
      pay("x2", { due_date: "2026-10-01", created_at: "2026-09-02T00:00:00Z" }),
      pay("x1", { due_date: "2026-10-01", created_at: "2026-09-01T00:00:00Z" }),
    ]);
    expect([map.get("x1")?.number, map.get("x2")?.number, map.get("sin")?.number]).toEqual([1, 2, 3]);
  });

  it("no cuenta reembolsos ni cancelados, y cada venta se numera aparte", () => {
    const map = paymentPositions([
      pay("a"), pay("canc", { status: "cancelled", due_date: "2026-09-01" }), pay("ref", { type: "refund", due_date: "2026-09-02" }),
      pay("z", { sale_id: "s2" }),
    ]);
    expect(map.get("a")).toEqual({ number: 1, total: 1 });
    expect(map.has("canc")).toBe(false);
    expect(map.get("ref")).toEqual({ number: null, total: 1 });
    expect(map.get("z")).toEqual({ number: 1, total: 1 });
  });
});

describe("paymentLabel", () => {
  it("dice «Cuota 2 de 6» y los otros tipos con su nombre", () => {
    expect(paymentLabel({ type: "installment", number: 2, total: 6 })).toBe("Cuota 2 de 6");
    expect(paymentLabel({ type: "full", number: 1, total: 1 })).toBe("Pago completo");
    expect(paymentLabel({ type: "reservation", number: 1, total: 4 })).toBe("Reserva");
    expect(paymentLabel({ type: "refund", number: null, total: 4 })).toBe("Reembolso");
  });
  it("sin pago (un ajuste) es un guion, y sin total no inventa uno", () => {
    expect(paymentLabel(null)).toBe("—");
    expect(paymentLabel({ type: "installment", number: 2, total: 0 })).toBe("Cuota 2");
    expect(paymentLabel({ type: "installment", number: null, total: 0 })).toBe("Cuota");
  });
});

describe("calcLabel", () => {
  it("porcentaje sobre el neto o el cobrado, con coma decimal", () => {
    expect(calcLabel({ calc_type: "percent", rate: 8, base: "net_of_fees" })).toBe("8 % del neto");
    expect(calcLabel({ calc_type: "percent", rate: 2.125, base: "gross" })).toBe("2,125 % del cobrado");
  });
  it("monto fijo en dólares", () => {
    expect(calcLabel({ calc_type: "fixed", fixed_amount: 15, base: "gross" })).toBe("USD 15,00 fijos");
  });
  it("sin foto de regla (un ajuste) no hay cálculo", () => {
    expect(calcLabel(null)).toBeNull();
    expect(calcLabel({})).toBeNull();
    expect(calcLabel([])).toBeNull();
  });
});

describe("expenseCellText", () => {
  const base = { voided_at: null, user_id: "u", available_on: "2026-10-01" };
  it("programado y pagado llevan su fecha corta", () => {
    const programado = commissionStatus({ ...base, expense_id: "e" }, { status: "programado", scheduled_date: "2026-11-05", paid_date: null }, "2026-10-15");
    expect(expenseCellText(programado, true)).toBe("Programado 5/11");
    const pagado = commissionStatus({ ...base, expense_id: "e" }, { status: "pagado", scheduled_date: "2026-11-01", paid_date: "2026-11-06" }, "2026-11-10");
    expect(expenseCellText(pagado, true)).toBe("Pagado 6/11");
  });
  it("sin gasto no hay texto", () => {
    expect(expenseCellText(commissionStatus({ ...base, expense_id: null }, null, "2026-10-15"), false)).toBeNull();
  });
});
