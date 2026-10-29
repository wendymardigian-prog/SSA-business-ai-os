import { describe, expect, it } from "vitest";
import { planRowActions } from "./row-actions";

const base = { contactId: "c1", viewerId: "ana", canEditContacts: true, canDeleteContacts: false };

describe("planRowActions", () => {
  it("sin marcas: marcar cliente, marcar conocido y abrir la ficha", () => {
    expect(planRowActions({ ...base, contact: {} })).toEqual(["markCustomer", "markKnown", "openContact"]);
  });

  it("sin permiso de edicion solo abre la ficha", () => {
    expect(planRowActions({ ...base, canEditContacts: false, contact: { is_known: true, known_marked_by: "ana" } })).toEqual(["openContact"]);
  });

  it("quitar: quien la puso o un administrador", () => {
    expect(planRowActions({ ...base, contact: { is_customer: true, customer_marked_by: "ana" } })).toContain("unmarkCustomer");
    expect(planRowActions({ ...base, contact: { is_customer: true, customer_marked_by: "beto" } })).not.toContain("unmarkCustomer");
    expect(planRowActions({ ...base, canDeleteContacts: true, contact: { is_customer: true, customer_marked_by: null } })).toContain("unmarkCustomer");
  });

  it("un cliente que vino de un cobro solo lo desmarca un administrador", () => {
    expect(planRowActions({ ...base, contact: { is_customer: true, customer_marked_by: null, customer_source: "sale" } })).not.toContain(
      "unmarkCustomer",
    );
  });

  it("sin contacto no hay acciones", () => {
    expect(planRowActions({ ...base, contactId: null, contact: null })).toEqual([]);
  });
});
