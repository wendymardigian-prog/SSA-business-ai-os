import { describe, expect, it } from "vitest";
import { salesVariables, SALES_VARIABLE_KEYS } from "./variables";

const sale = {
  id: "s1", status: "reserved", final_amount: 1297, vendedor_id: "u1", setter_id: "u2", attribution_type: "last_touch",
  product_snapshot: { product_name: "Mentoría", variant_name: "Premium" },
  attribution: { source: "instagram", medium: "paid_social", campaign: "octubre", content: "Reel", term: "kw" },
};

describe("salesVariables", () => {
  it("arma las de la venta y del pago, todas como texto legible", () => {
    const v = salesVariables({
      sale, salePayments: [{ amount: 300, status: "paid" }, { amount: 997, status: "scheduled" }],
      payment: { id: "p1", amount: 997, due_date: "2026-10-26", payment_method: "wise", status: "overdue" },
      event: { sale_id: "s1", payment_id: "p1", from_status: "scheduled", to_status: "overdue", days_overdue: 3 },
      names: { u1: "Ana", u2: "Pablo" },
    });
    expect(v.sale).toMatchObject({
      id: "s1", product_name: "Mentoría", variant_name: "Premium", final_amount: "$1.297,00", balance: "$997,00", status: "Reservada",
      utm_source: "instagram", utm_medium: "paid_social", utm_campaign: "octubre", utm_content: "Reel", utm_term: "kw",
      attribution_type: "Último toque", vendedor_name: "Ana", setter_name: "Pablo",
    });
    expect(v.payment).toMatchObject({ id: "p1", amount: "$997,00", due_date: "26 de octubre de 2026", days_overdue: "3", method: "Wise", from_status: "Programado", to_status: "Moroso" });
  });

  it("el estado «desde» de la venta sale solo de un evento de venta", () => {
    expect(salesVariables({ sale, event: { sale_id: "s1", from_status: "paid", to_status: "cancelled" } }).sale.from_status).toBe("Pagada");
    expect(salesVariables({ sale, event: { sale_id: "s1", payment_id: "p1", from_status: "scheduled" } }).sale.from_status).toBe("");
  });

  it("lo que falta queda vacío: nunca «null» ni «undefined»", () => {
    const v = salesVariables({ sale: null, payment: null });
    for (const value of [...Object.values(v.sale), ...Object.values(v.payment), ...Object.values(v.contact)]) expect(value).toBe("");
  });

  it("el contacto de la venta: primer nombre y nombre completo (R3), sin cambiar las de siempre", () => {
    const v = salesVariables({ sale, contact: { display_name: "  Ana   María Pérez " } });
    expect(v.contact).toEqual({ first_name: "Ana", display_name: "Ana María Pérez" });
    expect(salesVariables({ sale, contact: { display_name: "Beto" } }).contact.first_name).toBe("Beto");
    expect(salesVariables({ sale, contact: null }).contact).toEqual({ first_name: "", display_name: "" });
    expect(Object.keys(v.sale)).toContain("product_name");
    expect(Object.keys(v.payment)).toContain("due_date");
  });

  it("la lista de claves coincide con lo que devuelve", () => {
    const v = salesVariables({ sale, payment: { id: "p", amount: 1, due_date: null, payment_method: null, status: "scheduled" } });
    for (const key of SALES_VARIABLE_KEYS) {
      const [group, name] = key.split(".") as ["sale" | "payment" | "contact", string];
      expect(Object.keys(v[group]), key).toContain(name);
    }
  });
});
