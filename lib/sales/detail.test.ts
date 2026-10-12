import { describe, expect, it } from "vitest";
import { saleNumbers } from "./detail";

describe("números de la ficha de la venta", () => {
  const payments = [
    { type: "reservation", status: "paid", amount: 300, due_date: "2026-10-01" },
    { type: "installment", status: "scheduled", amount: 500, due_date: "2026-12-01" },
    { type: "installment", status: "overdue", amount: 497, due_date: "2026-11-01" },
  ];

  it("saldo = final − cobrado; lo esperado y el próximo vencimiento salen de lo programado y moroso", () => {
    expect(saleNumbers(1297, payments)).toEqual({ total: 1297, paid: 300, refunded: 0, balance: 997, expected: 997, nextDue: "2026-11-01" });
  });

  it("un reembolso es una fila cobrada negativa: resta del cobrado y se muestra aparte", () => {
    const n = saleNumbers(1000, [
      { type: "full", status: "paid", amount: 1000, due_date: "2026-10-01" },
      { type: "refund", status: "paid", amount: -250, due_date: "2026-10-05" },
    ]);
    expect(n).toMatchObject({ paid: 750, refunded: 250, balance: 250 });
  });

  it("un incobrable no cambia el saldo ni cuenta como esperado", () => {
    const n = saleNumbers(500, [{ type: "installment", status: "uncollectible", amount: 500, due_date: "2026-10-01" }]);
    expect(n).toMatchObject({ balance: 500, expected: 0, nextDue: null });
  });
});
