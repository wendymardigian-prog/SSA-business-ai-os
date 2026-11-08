// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { clientRows, paidByContact } from "./clients";

describe("Clientes › Clientes", () => {
  it("una fila por contacto con «N · M activos»", () => {
    const rows = clientRows([
      { contactId: "a", status: "active", saleId: "s1" },
      { contactId: "a", status: "completed", saleId: "s2" },
      { contactId: "b", status: "paused", saleId: null },
    ]);
    expect(rows.find((r) => r.contactId === "a")?.servicesLabel).toBe("2 · 1 activo");
    expect(rows.find((r) => r.contactId === "b")?.servicesLabel).toBe("1 · 1 activo");
  });
  it("el total cobrado suma los pagos de sus ventas y descuenta los reembolsos", () => {
    const rows = clientRows([{ contactId: "a", status: "active", saleId: "s1" }, { contactId: "a", status: "active", saleId: "s2" }]);
    const paid = paidByContact(rows, [
      { saleId: "s1", amount: 500 },
      { saleId: "s2", amount: 300.5 },
      { saleId: "s2", amount: -100 },
      { saleId: "otra", amount: 999 },
    ]);
    expect(paid.get("a")).toBe(700.5);
  });
});
