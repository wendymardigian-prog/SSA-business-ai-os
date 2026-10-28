import { describe, expect, it } from "vitest";
import { contactMarks, customerAssignee, customerLabel, markGate } from "./marks";

describe("contactMarks", () => {
  it("cliente primero, despues conocido", () => {
    expect(contactMarks({ is_known: true, is_customer: true })).toEqual(["customer", "known"]);
    expect(contactMarks({ is_known: true })).toEqual(["known"]);
    expect(contactMarks({})).toEqual([]);
    expect(contactMarks(null)).toEqual([]);
  });
});

describe("markGate", () => {
  const viewer = { assignedTo: "beto", viewerId: "caro" };

  it("avisa a quien no la puso ni es el responsable", () => {
    expect(markGate({ is_customer: true, customer_marked_by: "ana" }, viewer)).toBe("customer");
    expect(markGate({ is_known: true, known_marked_by: "ana" }, viewer)).toBe("known");
  });

  it("no avisa a quien la puso ni al responsable", () => {
    expect(markGate({ is_customer: true, customer_marked_by: "caro" }, viewer)).toBeNull();
    expect(markGate({ is_customer: true, customer_marked_by: null }, { assignedTo: "caro", viewerId: "caro" })).toBeNull();
  });

  it("un cliente que vino de un cobro avisa a todos menos al responsable", () => {
    expect(markGate({ is_customer: true, customer_marked_by: null, customer_source: "sale" }, viewer)).toBe("customer");
  });

  it("con las dos marcas, alcanza con que una avise", () => {
    expect(markGate({ is_customer: true, customer_marked_by: "caro", is_known: true, known_marked_by: "ana" }, viewer)).toBe("known");
  });

  it("sin marcas no avisa", () => {
    expect(markGate({}, viewer)).toBeNull();
  });
});

describe("customerAssignee", () => {
  const members = ["ana", "beto"];

  it("la persona de la cuenta, despues la por defecto", () => {
    expect(customerAssignee({ by_channel: { c1: "ana" }, default_user_id: "beto" }, "c1", members)).toBe("ana");
    expect(customerAssignee({ by_channel: { c1: "ana" }, default_user_id: "beto" }, "c2", members)).toBe("beto");
  });

  it("sin nada configurado el responsable no cambia (null, sin Owner)", () => {
    expect(customerAssignee({}, "c1", members)).toBeNull();
    expect(customerAssignee({ default_user_id: "ex" }, "c1", members)).toBeNull();
  });
});

describe("customerLabel", () => {
  it("dice quien lo marco o que vino de un cobro", () => {
    expect(customerLabel("Ana")).toBe("Cliente de Ana");
    expect(customerLabel(null, "sale")).toBe("Cliente (compró)");
    expect(customerLabel(null)).toBe("Cliente");
  });
});
