import { describe, expect, it } from "vitest";
import { activeRoles, pickRoleTab, roleTabHref, rulesAccess } from "./rules-ui-access";
import { defaultCommissionRoles } from "./roles";

const can = (...keys: string[]) => (key: string) => keys.includes(key);

describe("rulesAccess", () => {
  it("commissions.manage edita, sin importar el alcance", () => {
    expect(rulesAccess(can("commissions.manage"), "own")).toBe("manage");
    expect(rulesAccess(can("commissions.manage", "commissions.view"), "all")).toBe("manage");
  });
  it("commissions.view con alcance all lo ve en solo lectura", () => {
    expect(rulesAccess(can("commissions.view"), "all")).toBe("read");
  });
  it("commissions.view con alcance own o own_unassigned no entra", () => {
    expect(rulesAccess(can("commissions.view"), "own")).toBe("none");
    expect(rulesAccess(can("commissions.view"), "own_unassigned")).toBe("none");
  });
  it("sin ningún permiso, no entra", () => {
    expect(rulesAccess(can(), "all")).toBe("none");
  });
});

describe("pickRoleTab", () => {
  const roles = defaultCommissionRoles();
  it("la pedida, si existe y está activa", () => {
    expect(pickRoleTab("setter", roles)).toBe("setter");
    expect(pickRoleTab(["pauta", "setter"], roles)).toBe("pauta");
  });
  it("sin pedido, o con uno inventado, la primera activa", () => {
    expect(pickRoleTab(undefined, roles)).toBe("vendedor");
    expect(pickRoleTab("nada", roles)).toBe("vendedor");
    expect(pickRoleTab("", roles)).toBe("vendedor");
  });
  it("un rol desactivado no tiene pestaña", () => {
    const off = roles.map((r) => (r.key === "vendedor" ? { ...r, active: false } : r));
    expect(pickRoleTab("vendedor", off)).toBe("setter");
    expect(activeRoles(off).map((r) => r.key)).toEqual(["setter", "contenido", "pauta"]);
  });
  it("sin roles activos, null", () => {
    expect(pickRoleTab("vendedor", roles.map((r) => ({ ...r, active: false })))).toBeNull();
  });
});

describe("roleTabHref", () => {
  it("lleva el rol en la URL", () => {
    expect(roleTabHref("setter")).toBe("/dashboard/finanzas/comisiones/reglas?rol=setter");
  });
});
