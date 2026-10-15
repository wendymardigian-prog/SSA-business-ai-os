import { describe, expect, it } from "vitest";
import { addRole, renameRole, rolesChanged, rolesPayload, rolesProblem, roleProblems, setRoleActive, PAYEE_CHOICES } from "./rules-ui-roles";
import { ruleMissingPerson } from "./rules-ui-warnings";
import { defaultCommissionRoles } from "./roles";

const NOW = "2026-10-15T12:00:00.000Z";

describe("addRole", () => {
  it("agrega al final con una clave armada con el nombre", () => {
    const next = addRole(defaultCommissionRoles(), "  Marketing orgánico ", "content_assignee", NOW);
    expect(next).toHaveLength(5);
    expect(next[4]).toEqual({ key: "marketing_organico", name: "Marketing orgánico", payee: "content_assignee", active: true, system: false, created_at: NOW });
  });
  it("una clave repetida se desambigua", () => {
    const once = addRole(defaultCommissionRoles(), "Marketing", "fixed", NOW);
    const twice = addRole(once, "marketing", "fixed", NOW);
    expect(twice.map((r) => r.key).slice(4)).toEqual(["marketing", "marketing_2"]);
  });
  it("un nombre vacío no agrega nada", () => {
    expect(addRole(defaultCommissionRoles(), "   ", "fixed", NOW)).toHaveLength(4);
  });
});

describe("renameRole / setRoleActive / rolesChanged", () => {
  const before = defaultCommissionRoles();
  it("cambian solo el rol pedido", () => {
    const after = setRoleActive(renameRole(before, "setter", "Prospector"), "pauta", false);
    expect(after.find((r) => r.key === "setter")?.name).toBe("Prospector");
    expect(after.find((r) => r.key === "pauta")?.active).toBe(false);
    expect(after.find((r) => r.key === "vendedor")).toEqual(before[0]);
    expect(rolesChanged(before, after)).toBe(true);
  });
  it("sin cambios, o con solo espacios de más, no hay nada para guardar", () => {
    expect(rolesChanged(before, before.map((r) => ({ ...r })))).toBe(false);
    expect(rolesChanged(before, renameRole(before, "setter", "Setter  "))).toBe(false);
  });
});

describe("validación", () => {
  const before = defaultCommissionRoles();
  it("lo válido pasa", () => {
    expect(rolesProblem(before, addRole(before, "Marketing", "fixed", NOW))).toBeNull();
  });
  it("un nombre vacío o repetido se dice en su rol", () => {
    expect(rolesProblem(before, renameRole(before, "setter", "  "))).toBe("Poné un nombre al rol");
    expect(roleProblems(before, renameRole(before, "setter", "vendedor"))).toEqual({ setter: "Ya hay un rol que se llama «vendedor»" });
  });
  it("no se puede sacar un rol", () => {
    expect(rolesProblem(before, before.slice(1))).toContain("no se puede borrar");
  });
});

describe("rolesPayload y PAYEE_CHOICES", () => {
  it("manda solo lo que la acción espera", () => {
    expect(rolesPayload(defaultCommissionRoles())[0]).toEqual({ key: "vendedor", name: "Vendedor", payee: "sale_vendedor", active: true });
  });
  it("ofrece las cuatro formas de pagar, en palabras", () => {
    expect(PAYEE_CHOICES.map((c) => c.label)).toEqual(["El vendedor de la venta", "El setter de la venta", "El responsable de la pieza", "Una persona fija"]);
  });
});

describe("ruleMissingPerson", () => {
  const fixed = { payee: "fixed" as const };
  it("solo un rol de persona fija sin persona y sin archivar", () => {
    expect(ruleMissingPerson(fixed, { beneficiary_user_id: null, archived_at: null })).toBe(true);
    expect(ruleMissingPerson(fixed, { beneficiary_user_id: "x", archived_at: null })).toBe(false);
    expect(ruleMissingPerson(fixed, { beneficiary_user_id: null, archived_at: "2026-01-01" })).toBe(false);
    expect(ruleMissingPerson({ payee: "sale_vendedor" }, { beneficiary_user_id: null, archived_at: null })).toBe(false);
    expect(ruleMissingPerson(undefined, { beneficiary_user_id: null, archived_at: null })).toBe(false);
  });
});
