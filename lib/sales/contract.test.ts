import { describe, expect, it } from "vitest";
import type { FormField } from "@/lib/forms/fields";
import { buildContractPrefill, contractLinkValues, contractMessage, paymentPlanLines, unsignedContracts, type ContractPayment } from "./contract";

const field = (key: string, params?: string[]): FormField => ({
  id: key, key, type: "short_text", label: key, required: false, ...(params ? { prefill: { params, behavior: "editable" } } : {}),
} as FormField);

const sale = {
  product_snapshot: { product_name: "Mentoría", variant_name: "Premium" },
  final_amount: 1297,
  service_starts_at: "2026-11-01",
};
const contact = { display_name: "Ana Pérez", email: "ana@x.co", phone: "+50688887777" };

describe("buildContractPrefill", () => {
  it("mapea nombre, email, teléfono, producto, monto y fecha a los campos que los declaran", () => {
    const fields = [field("nombre"), field("email"), field("telefono"), field("producto"), field("monto"), field("inicio_servicio")];
    const r = buildContractPrefill(sale, contact, fields);
    expect(r.params).toEqual({ nombre: "Ana Pérez", email: "ana@x.co", telefono: "+50688887777", producto: "Mentoría", monto: "1297.00", inicio_servicio: "2026-11-01" });
    expect(r.preview.map((p) => p.label)).toEqual(["Nombre", "Email", "Teléfono", "Producto", "Monto", "Inicio del servicio"]);
  });

  it("ignora lo que el formulario no declara y usa el nombre que declara cada campo", () => {
    const fields = [field("cliente", ["full_name", "nombre"]), field("empresa")];
    const r = buildContractPrefill(sale, contact, fields);
    expect(r.params).toEqual({ full_name: "Ana Pérez" });
  });

  it("no manda lo que no tiene valor, y nunca el sale_id como parámetro suelto", () => {
    const r = buildContractPrefill({ ...sale, service_starts_at: null }, { display_name: null, email: null, phone: null }, [field("nombre"), field("email"), field("inicio_servicio"), field("sale_id"), field("monto")]);
    expect(r.params).toEqual({ monto: "1297.00" });
    expect(Object.keys(r.params)).not.toContain("sale_id");
  });

  it("un campo oculto no se prellena", () => {
    const hidden = { id: "h", key: "email", type: "hidden", label: "h", required: false } as FormField;
    expect(buildContractPrefill(sale, contact, [hidden]).params).toEqual({});
  });
});

describe("unsignedContracts", () => {
  it("un envío sin firma posterior queda «sin firmar»; con firma posterior, no", () => {
    const sent = [{ form_id: "f1", sent_at: "2026-10-01T10:00:00Z" }, { form_id: "f2", sent_at: "2026-10-02T10:00:00Z" }];
    const signed = [{ form_id: "f1", signed_at: "2026-10-03T10:00:00Z" }];
    expect(unsignedContracts(sent, signed)).toEqual([{ form_id: "f2", sent_at: "2026-10-02T10:00:00Z" }]);
  });

  it("una firma anterior al último envío no lo cubre (se reenvió después)", () => {
    const sent = [{ form_id: "f1", sent_at: "2026-10-01T10:00:00Z" }, { form_id: "f1", sent_at: "2026-10-05T10:00:00Z" }];
    expect(unsignedContracts(sent, [{ form_id: "f1", signed_at: "2026-10-03T10:00:00Z" }])).toHaveLength(1);
  });
});

describe("contractMessage", () => {
  it("saluda por el primer nombre y lleva el link", () => {
    expect(contractMessage({ contactName: "Ana Pérez", formName: "Contrato de servicios", url: "https://x.test/f/c?c=t" })).toBe("Hola Ana! Te dejo el link para firmar Contrato de servicios: https://x.test/f/c?c=t");
    expect(contractMessage({ contactName: null, formName: "C", url: "u" })).toBe("Hola! Te dejo el link para firmar C: u");
  });
});

describe("contractLinkValues (variables del contrato en modo Contrato)", () => {
  it("los mismos valores que el prellenado, con los nombres de las variables", () => {
    expect(contractLinkValues(sale, contact)).toEqual({
      contacto: { nombre: "Ana Pérez", email: "ana@x.co", telefono: "+50688887777" },
      venta: { producto: "Mentoría", variante: "Premium", monto: "1297.00", inicio_servicio: "2026-11-01" },
    });
  });

  it("sin venta, solo el contacto; sin nada, todo vacío", () => {
    expect(contractLinkValues(null, contact).venta).toEqual({});
    expect(contractLinkValues(null, null).contacto).toEqual({ nombre: null, email: null, telefono: null });
  });
});

describe("paymentPlanLines (variable {{venta.plan_pagos}})", () => {
  const pay = (p: Partial<ContractPayment>): ContractPayment => ({
    type: "installment", status: "scheduled", amount: 1000, due_date: null, paid_on: null, paid_at: null, created_at: "2026-11-01T10:00:00Z", ...p,
  });

  it("un renglón por pago, en orden de vencimiento, con las cuotas numeradas", () => {
    const lines = paymentPlanLines([
      pay({ due_date: "2027-01-03", status: "overdue" }),
      pay({ type: "reservation", amount: 500, status: "paid", due_date: "2026-11-03", paid_on: "2026-11-03" }),
      pay({ due_date: "2026-12-03" }),
    ]);
    expect(lines).toEqual([
      "Reserva — USD 500,00 — Cobrado el 3 de noviembre de 2026",
      "Cuota 1 de 2 — USD 1.000,00 — Programado para el 3 de diciembre de 2026",
      "Cuota 2 de 2 — USD 1.000,00 — Moroso, vencía el 3 de enero de 2027",
    ]);
  });

  it("deja afuera los anulados y las devoluciones", () => {
    const lines = paymentPlanLines([
      pay({ type: "full", status: "paid", paid_on: "2026-11-03", amount: 1297 }),
      pay({ status: "cancelled", due_date: "2026-12-03" }),
      pay({ type: "refund", status: "paid", amount: -100, paid_on: "2026-11-10" }),
    ]);
    expect(lines).toEqual(["Pago completo — USD 1.297,00 — Cobrado el 3 de noviembre de 2026"]);
  });

  it("los otros estados y las fechas que faltan", () => {
    expect(paymentPlanLines([pay({ status: "uncollectible", due_date: "2026-12-01" })])).toEqual(["Cuota 1 de 1 — USD 1.000,00 — Incobrable"]);
    expect(paymentPlanLines([pay({ type: "full", status: "refunded" })])).toEqual(["Pago completo — USD 1.000,00 — Reembolsado"]);
    expect(paymentPlanLines([pay({ type: "full" })])).toEqual(["Pago completo — USD 1.000,00 — Programado"]);
    expect(paymentPlanLines([pay({ type: "full", status: "paid" })])).toEqual(["Pago completo — USD 1.000,00 — Cobrado"]);
  });

  it("sin paid_on usa paid_at en la zona del negocio; sin fecha va al final", () => {
    const lines = paymentPlanLines(
      [pay({ type: "full", status: "paid", paid_at: "2026-11-04T03:00:00Z" }), pay({ type: "reservation", due_date: "2026-10-01", status: "paid", paid_on: "2026-10-01" })],
      "America/Costa_Rica",
    );
    expect(lines).toEqual(["Reserva — USD 1.000,00 — Cobrado el 1 de octubre de 2026", "Pago completo — USD 1.000,00 — Cobrado el 3 de noviembre de 2026"]);
  });

  it("contractLinkValues: con pagos arma el plan; si no se pudieron leer, null", () => {
    expect(contractLinkValues({ ...sale, payments: [pay({ type: "full", amount: 1297 })] }, contact).venta?.plan_pagos).toEqual(["Pago completo — USD 1.297,00 — Programado"]);
    expect(contractLinkValues({ ...sale, payments: null }, contact).venta?.plan_pagos).toBeNull();
  });
});
