import { describe, expect, it } from "vitest";
import { manualContactSchema, resolveFoundContact } from "./contacts";

describe("manualContactSchema", () => {
  it("el nombre es obligatorio y hace falta email o teléfono", () => {
    expect(manualContactSchema.safeParse({ name: "Ana" }).success).toBe(false);
    expect(manualContactSchema.safeParse({ name: "", email: "a@b.co" }).success).toBe(false);
    expect(manualContactSchema.safeParse({ name: "Ana", email: "a@b.co" }).success).toBe(true);
    expect(manualContactSchema.safeParse({ name: "Ana", phone: "+50688887777" }).success).toBe(true);
    expect(manualContactSchema.safeParse({ name: "Ana", email: "no-es-un-email" }).success).toBe(false);
  });
});

describe("resolveFoundContact", () => {
  it("con un contact_id se usa ese contacto y se avisa", () => {
    expect(resolveFoundContact({ contact_id: "c1", matched_by: "phone" })).toMatchObject({ kind: "existing", contactId: "c1", conflictContactId: null, notice: "Ya existía: se usó ese contacto." });
  });
  it("si el email es de otro contacto (conflicto), el teléfono gana y se avisa", () => {
    const r = resolveFoundContact({ contact_id: "c1", matched_by: "phone", conflict_contact_id: "c2" });
    expect(r).toMatchObject({ kind: "existing", contactId: "c1", conflictContactId: "c2" });
    expect(r.kind === "existing" && r.notice).toContain("El email pertenece a otro contacto");
  });
  it("con null, la Server Action crea exactamente uno", () => {
    expect(resolveFoundContact({ contact_id: null })).toEqual({ kind: "create" });
    expect(resolveFoundContact(null)).toEqual({ kind: "create" });
  });
});
