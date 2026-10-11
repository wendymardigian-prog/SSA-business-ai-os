import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_PERMISSIONS, normalizeScope, parsePermissions } from "@/lib/auth/permissions";
import { canCreateSaleFor, canSeeSale } from "./permissions";

const member = (userId = "u1") => ({ userId, role: "member" as const, permissions: SYSTEM_ROLE_PERMISSIONS.member });
const custom = (scope: "own" | "all") => ({
  userId: "u9",
  role: "member" as const,
  permissions: parsePermissions({ keys: ["sales.view", "sales.manage"], scopes: { sales: scope } }),
});

describe("permisos de Ventas en los roles de sistema", () => {
  it("el Member tiene las 3 claves con alcance own y NO tiene settings.manage", () => {
    const p = SYSTEM_ROLE_PERMISSIONS.member;
    expect(p.keys).toEqual(expect.arrayContaining(["sales.view", "sales.manage", "payments.manage"]));
    expect(p.keys).not.toContain("settings.manage");
    expect(p.scopes.sales).toBe("own");
  });

  it("Owner y Admin tienen las 3 con alcance all", () => {
    for (const role of ["owner", "admin"] as const) {
      const p = SYSTEM_ROLE_PERMISSIONS[role];
      expect(p.keys).toEqual(expect.arrayContaining(["sales.view", "sales.manage", "payments.manage"]));
      expect(p.scopes.sales).toBe("all");
    }
  });

  it("own_unassigned no existe para ventas: queda en own", () => {
    expect(normalizeScope("sales", "own_unassigned")).toBe("own");
  });

  it("un rol personalizado sin alcance guardado queda en own", () => {
    expect(parsePermissions({ keys: ["sales.view"], scopes: {} }).scopes.sales).toBe("own");
  });
});

describe("canSeeSale", () => {
  const sale = { setter_id: "ana", vendedor_id: "beto" };

  it("el setter la ve aunque no sea vendedor", () => {
    expect(canSeeSale(member("ana"), sale)).toBe(true);
  });
  it("el vendedor la ve", () => {
    expect(canSeeSale(member("beto"), sale)).toBe(true);
  });
  it("un Member que no es ni setter ni vendedor no la ve", () => {
    expect(canSeeSale(member("carla"), sale)).toBe(false);
  });
  it("un rol personalizado con sales.view y alcance all la ve", () => {
    expect(canSeeSale(custom("all"), sale)).toBe(true);
  });
  it("un rol personalizado con alcance own no la ve", () => {
    expect(canSeeSale(custom("own"), sale)).toBe(false);
  });
  it("Owner y Admin la ven siempre", () => {
    expect(canSeeSale({ userId: "x", role: "admin", permissions: SYSTEM_ROLE_PERMISSIONS.admin }, sale)).toBe(true);
    expect(canSeeSale({ userId: "x", role: "owner", permissions: SYSTEM_ROLE_PERMISSIONS.owner }, sale)).toBe(true);
  });
});

describe("canCreateSaleFor", () => {
  it("un Member own no crea una venta donde no queda como setter ni vendedor", () => {
    expect(canCreateSaleFor(member("carla"), { setter_id: "ana", vendedor_id: null })).toBe(false);
    expect(canCreateSaleFor(member("carla"), { setter_id: null, vendedor_id: "carla" })).toBe(true);
  });
  it("sin sales.manage no crea", () => {
    expect(canCreateSaleFor({ userId: "u", role: "member", permissions: parsePermissions({ keys: ["sales.view"], scopes: {} }) }, { setter_id: "u", vendedor_id: null })).toBe(false);
  });
});
