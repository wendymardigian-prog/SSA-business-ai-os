import { describe, expect, it } from "vitest";
import { nextPayment, openPayments } from "./next-payment";

describe("pagos abiertos y el próximo pago", () => {
  const payments = [
    { id: "p1", amount: 400, status: "paid", due_date: "2026-09-01" },
    { id: "p2", amount: "500.00", status: "scheduled", due_date: "2026-12-10" },
    { id: "p3", amount: 300, status: "overdue", due_date: "2026-11-01" },
    { id: "p4", amount: 100, status: "scheduled", due_date: null },
    { id: "p5", amount: -50, status: "paid", due_date: "2026-10-01" },
    { id: "p6", amount: 200, status: "uncollectible", due_date: "2026-08-01" },
    { id: "p7", amount: 200, status: "cancelled", due_date: "2026-08-01" },
  ];

  it("solo morosos y programados, por fecha, los sin fecha al final", () => {
    expect(openPayments(payments).map((p) => p.id)).toEqual(["p3", "p2", "p4"]);
  });

  it("el próximo es el más viejo sin cobrar, aunque esté vencido", () => {
    expect(nextPayment(payments)).toEqual({ id: "p3", dueDate: "2026-11-01", amount: 300, overdue: true });
  });

  it("el monto pasa por céntimos", () => {
    expect(openPayments([{ amount: "416.67", status: "scheduled", due_date: "2026-12-01" }])[0].amount).toBe(416.67);
  });

  it("misma fecha: desempate por id", () => {
    const same = [
      { id: "b", amount: 1, status: "scheduled", due_date: "2026-12-01" },
      { id: "a", amount: 1, status: "scheduled", due_date: "2026-12-01" },
    ];
    expect(openPayments(same).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("sin pagos abiertos no hay próximo", () => {
    expect(nextPayment([{ amount: 10, status: "paid", due_date: "2026-01-01" }])).toBeNull();
    expect(nextPayment(null)).toBeNull();
  });
});
