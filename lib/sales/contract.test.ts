import { describe, expect, it } from "vitest";
import type { FormField } from "@/lib/forms/fields";
import { buildContractPrefill, contractMessage, unsignedContracts } from "./contract";

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
