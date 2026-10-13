import { describe, it, expect } from "vitest";
import { describeContactUniqueViolation } from "./unique-errors";

describe("describeContactUniqueViolation", () => {
  it("telefono", () => {
    expect(describeContactUniqueViolation({ code: "23505", message: 'duplicate key value violates unique constraint "uq_contacts_workspace_phone"' })).toBe("Ese telefono ya es de otro contacto");
  });
  it("email", () => {
    expect(describeContactUniqueViolation({ code: "23505", message: 'violates unique constraint "uq_contacts_workspace_email"' })).toBe("Ese email ya es de otro contacto");
  });
  it("otro unico o otro codigo: nada", () => {
    expect(describeContactUniqueViolation({ code: "23505", message: 'constraint "otra"' })).toBeNull();
    expect(describeContactUniqueViolation({ code: "42501", message: "uq_contacts_workspace_phone" })).toBeNull();
    expect(describeContactUniqueViolation(null)).toBeNull();
  });
});
