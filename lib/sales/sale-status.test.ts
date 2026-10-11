import { describe, expect, it } from "vitest";
import cases from "./sale-status.cases.json";
import { deriveSaleStatus } from "./sale-status";

describe("deriveSaleStatus (los casos compartidos con derive_sale_status de SQL)", () => {
  for (const c of cases) {
    it(c.name, () => {
      const got = deriveSaleStatus({ status: (c as { current_status?: string }).current_status ?? null, financing_type: c.financing_type, final_amount: c.final_amount }, c.payments);
      expect(got).toBe(c.expected);
    });
  }

  it("hay al menos 7 casos y cubre los 9 estados salvo los que solo escribe una acción", () => {
    expect(cases.length).toBeGreaterThanOrEqual(7);
    const expected = new Set(cases.map((c) => c.expected));
    for (const status of ["pending_payment", "reserved", "paid", "overdue", "subscription_active", "cancelled", "refunded", "disputed"]) {
      expect(expected.has(status), status).toBe(true);
    }
  });

  it("un estado desconocido en la fila no es un estado escrito: se deriva", () => {
    expect(deriveSaleStatus({ status: "raro", financing_type: "full", final_amount: 10 }, [{ type: "full", status: "paid", amount: 10 }])).toBe("paid");
  });

  it("un monto inválido de la base no rompe (cuenta como cero)", () => {
    expect(deriveSaleStatus({ financing_type: "full", final_amount: 100 }, [{ type: "full", status: "paid", amount: undefined }])).toBe("pending_payment");
  });
});
