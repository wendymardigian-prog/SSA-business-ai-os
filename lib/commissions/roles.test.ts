import { describe, expect, it } from "vitest";
import { PRELOADED_ROLES, ROLE_KEY_PATTERN, defaultCommissionRoles, newRoleKey, parseCommissionRoles, payeeLabel, validateRolesUpdate } from "./roles";
import type { CommissionRole } from "./types";

const custom = (patch: Partial<CommissionRole> = {}): CommissionRole => ({ key: "marketing", name: "Marketing", payee: "fixed", active: true, system: false, created_at: "2026-10-15T00:00:00.000Z", ...patch });

describe("PRELOADED_ROLES", () => {
  it("son cuatro, de sistema, con su payee", () => {
    expect(PRELOADED_ROLES.map((r) => [r.key, r.payee, r.system, r.active])).toEqual([
      ["vendedor", "sale_vendedor", true, true],
      ["setter", "sale_setter", true, true],
      ["contenido", "content_assignee", true, true],
      ["pauta", "fixed", true, true],
    ]);
    for (const r of PRELOADED_ROLES) expect(r.key).toMatch(ROLE_KEY_PATTERN);
  });
  it("defaultCommissionRoles devuelve copias", () => {
    const a = defaultCommissionRoles();
    a[0].name = "X";
    expect(PRELOADED_ROLES[0].name).toBe("Vendedor");
  });
});

describe("payeeLabel", () => {
  it("en palabras", () => {
    expect(payeeLabel("sale_vendedor")).toBe("El vendedor de la venta");
    expect(payeeLabel("sale_setter")).toBe("El setter de la venta");
    expect(payeeLabel("content_assignee")).toBe("El responsable de la pieza");
    expect(payeeLabel("fixed")).toBe("Una persona fija");
  });
});

describe("parseCommissionRoles (nunca lanza)", () => {
  it("lo que no se entiende da los precargados", () => {
    for (const bad of [null, undefined, 0, "x", [], {}, { roles: "x" }, { roles: [null, 3, "a", {}] }]) {
      expect(parseCommissionRoles(bad)).toEqual(defaultCommissionRoles());
    }
  });
  it("lee { roles } o la lista, y conserva los del negocio", () => {
    const roles = [...defaultCommissionRoles(), custom()];
    expect(parseCommissionRoles({ roles })).toEqual(roles);
    expect(parseCommissionRoles(roles)).toEqual(roles);
  });
  it("descarta claves inválidas, repetidas, sin nombre o con payee desconocido", () => {
    const parsed = parseCommissionRoles({
      roles: [custom({ key: "BAD KEY" }), custom({ key: "ok_1", name: "Uno" }), custom({ key: "ok_1", name: "Dos" }), custom({ key: "ok_2", name: "  " }), { ...custom({ key: "ok_3" }), payee: "nadie" }],
    });
    expect(parsed.map((r) => r.key)).toEqual(["vendedor", "setter", "contenido", "pauta", "ok_1"]);
    expect(parsed.find((r) => r.key === "ok_1")?.name).toBe("Uno");
  });
  it("un precargado alterado vuelve a su payee y a system", () => {
    const parsed = parseCommissionRoles({ roles: [{ ...PRELOADED_ROLES[0], payee: "fixed", system: false, name: "Closer" }] });
    expect(parsed[0]).toMatchObject({ key: "vendedor", name: "Closer", payee: "sale_vendedor", system: true });
  });
  it("un rol del negocio nunca es de sistema, aunque lo diga el json", () => {
    expect(parseCommissionRoles({ roles: [custom({ system: true })] }).find((r) => r.key === "marketing")?.system).toBe(false);
  });
  it("active ausente cuenta como activo", () => {
    const { active: _a, ...rest } = custom();
    void _a;
    expect(parseCommissionRoles({ roles: [rest] }).find((r) => r.key === "marketing")?.active).toBe(true);
  });
});

describe("newRoleKey", () => {
  it("minúsculas, sin tildes, con guiones bajos", () => {
    expect(newRoleKey("Marketing orgánico", [])).toBe("marketing_organico");
    expect(newRoleKey("  Content   manager!! ", [])).toBe("content_manager");
    expect(newRoleKey("Ñandú & Co.", [])).toBe("nandu_co");
  });
  it("agrega un número si ya existe", () => {
    expect(newRoleKey("Marketing", ["marketing"])).toBe("marketing_2");
    expect(newRoleKey("Marketing", ["marketing", "marketing_2"])).toBe("marketing_3");
    expect(newRoleKey("Marketing", [custom()])).toBe("marketing_2");
  });
  it("siempre cumple el patrón, también con nombres vacíos o larguísimos", () => {
    for (const name of ["", "   ", "!", "a", "🙂🙂", "x".repeat(200), "ñ".repeat(60)]) {
      expect(newRoleKey(name, [])).toMatch(ROLE_KEY_PATTERN);
    }
    const long = "x".repeat(200);
    const first = newRoleKey(long, []);
    expect(first).toHaveLength(40);
    const second = newRoleKey(long, [first]);
    expect(second).toMatch(ROLE_KEY_PATTERN);
    expect(second).not.toBe(first);
  });
  it("un nombre sin letras ni números cae a 'rol'", () => {
    expect(newRoleKey("???", [])).toBe("rol");
    expect(newRoleKey("???", ["rol"])).toBe("rol_2");
  });
});

describe("validateRolesUpdate", () => {
  const before = [...defaultCommissionRoles(), custom()];
  const codes = (after: CommissionRole[]) => validateRolesUpdate(before, after).issues.map((i) => i.code);

  it("sin cambios es válido", () => {
    expect(validateRolesUpdate(before, before)).toEqual({ ok: true, issues: [] });
  });
  it("renombrar, desactivar y crear uno nuevo es válido", () => {
    const after = before.map((r) => (r.key === "vendedor" ? { ...r, name: "Closer", active: false } : r));
    after.push(custom({ key: "content_manager", name: "Content manager", payee: "content_assignee" }));
    expect(validateRolesUpdate(before, after).ok).toBe(true);
  });
  it("rechaza borrar un rol", () => {
    expect(codes(before.filter((r) => r.key !== "marketing"))).toContain("key_removed");
    expect(codes(before.filter((r) => r.key !== "vendedor"))).toContain("key_removed");
  });
  it("rechaza cambiar la key de uno existente (es un borrado más un alta)", () => {
    expect(codes(before.map((r) => (r.key === "marketing" ? { ...r, key: "marketing_2" } : r)))).toContain("key_removed");
  });
  it("rechaza cambiar el payee de un precargado", () => {
    expect(codes(before.map((r) => (r.key === "vendedor" ? { ...r, payee: "fixed" as const } : r)))).toContain("payee_changed");
  });
  it("tampoco deja cambiar el payee de uno del negocio", () => {
    expect(codes(before.map((r) => (r.key === "marketing" ? { ...r, payee: "sale_setter" as const } : r)))).toContain("payee_changed");
  });
  it("rechaza nombres repetidos sin importar mayúsculas ni espacios", () => {
    expect(codes([...before, custom({ key: "otro", name: "  VENDEDOR " })])).toContain("name_duplicate");
  });
  it("rechaza nombre vacío, demasiado largo, clave inválida o repetida y payee desconocido", () => {
    expect(codes(before.map((r) => (r.key === "marketing" ? { ...r, name: " " } : r)))).toContain("name_empty");
    expect(codes(before.map((r) => (r.key === "marketing" ? { ...r, name: "x".repeat(61) } : r)))).toContain("name_too_long");
    expect(codes([...before, custom({ key: "Mala Clave", name: "Otro" })])).toContain("key_invalid");
    expect(codes([...before, custom({ name: "Otro" })])).toContain("key_duplicate");
    expect(codes([...before, custom({ key: "otro", name: "Otro", payee: "nadie" as never })])).toContain("payee_invalid");
  });
  it("rechaza que un rol existente cambie de system y que uno nuevo nazca de sistema", () => {
    expect(codes(before.map((r) => (r.key === "vendedor" ? { ...r, system: false } : r)))).toContain("system_changed");
    expect(codes([...before, custom({ key: "nuevo", name: "Nuevo", system: true })])).toContain("system_changed");
  });
  it("cada problema trae un mensaje para la persona", () => {
    const r = validateRolesUpdate(before, before.filter((x) => x.key !== "marketing"));
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toMatch(/desactivalo/);
  });
});
