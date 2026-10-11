/**
 * Crear, editar y borrar roles (F71).
 */

import { describe, it, expect } from "vitest";
import { SYSTEM_ROLE_PERMISSIONS } from "./permissions";
import {
  canDeleteRole,
  canEditRole,
  describeRole,
  MAX_NAME_LENGTH,
  moduleState,
  sortRoles,
  toggleModule,
  validateRole,
  type RoleRow,
} from "./roles-admin";

const role = (over: Partial<RoleRow> = {}): RoleRow => ({
  id: "r-1",
  name: "Setter senior",
  description: null,
  systemRole: null,
  permissions: { keys: ["contacts.view"], scopes: { leads: "own", conversations: "own", bookings: "own", calls: "own" } },
  members: 0,
  ...over,
});

describe("validar un rol (F71)", () => {
  it("uno bien armado pasa", () => {
    const result = validateRole({
      name: "Setter senior",
      keys: ["contacts.view", "contacts.edit"],
      scopes: { leads: "all" },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.role.permissions.scopes.leads).toBe("all");
  });

  it("un nombre muy corto o muy largo se rechaza", () => {
    expect(validateRole({ name: "S", keys: [], scopes: {} }).ok).toBe(false);
    expect(validateRole({ name: "x".repeat(MAX_NAME_LENGTH + 1), keys: [], scopes: {} }).ok).toBe(false);
  });

  it("no se puede llamar como un rol de sistema", () => {
    // Dos "Admin" en el selector del equipo serian imposibles de distinguir.
    const result = validateRole({ name: "admin", keys: [], scopes: {} });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain("rol de sistema");
  });

  it("un rol sin permisos se avisa pero no se bloquea", () => {
    // Puede ser un rol en construccion; pero quien lo tenga no va a poder
    // hacer nada y no va a entender por que.
    const result = validateRole({ name: "Vacio", keys: [], scopes: {} });

    expect(result.ok).toBe(true);
    expect(result.ok && result.role.warnings[0]).toContain("no va a poder hacer nada");
  });

  it("las claves que ya no existen se descartan y se avisan", () => {
    const result = validateRole({
      name: "Setter",
      keys: ["contacts.view", "clave.vieja"],
      scopes: {},
    });

    expect(result.ok && result.role.permissions.keys).toEqual(["contacts.view"]);
    expect(result.ok && result.role.warnings.some((w) => w.includes("ya no existen"))).toBe(true);
  });

  it("responder sin ver se corrige: sin ver no se llega a la conversacion", () => {
    const result = validateRole({ name: "Setter", keys: ["inbox.whatsapp.reply"], scopes: {} });

    expect(result.ok && result.role.permissions.keys).toContain("inbox.whatsapp.view");
    expect(result.ok && result.role.warnings.some((w) => w.includes("se agrego"))).toBe(true);
  });

  it("editar sin ver tambien se corrige", () => {
    const result = validateRole({ name: "Editor", keys: ["flows.edit", "content.create"], scopes: {} });

    expect(result.ok && result.role.permissions.keys).toContain("flows.view");
    expect(result.ok && result.role.permissions.keys).toContain("content.view");
  });

  it("sin alcance elegido, el mas restrictivo", () => {
    const result = validateRole({ name: "Setter", keys: ["contacts.view"], scopes: {} });

    expect(result.ok && result.role.permissions.scopes).toEqual({ leads: "own", conversations: "own", bookings: "own", calls: "own" });
  });
});

describe("editar (F71)", () => {
  it("un rol personalizado, si", () => {
    expect(canEditRole(role())).toEqual({ ok: true });
  });

  it("uno de sistema, no, y dice que hacer en cambio", () => {
    // Si alguien le saca un permiso al rol Admin, la mitad del sistema deja
    // de andar sin que quede claro por que.
    const result = canEditRole(role({ systemRole: "admin" }));

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain("Creá un rol nuevo");
  });
});

describe("borrar (F71)", () => {
  it("uno sin gente, si", () => {
    expect(canDeleteRole(role())).toEqual({ ok: true });
  });

  it("uno con gente, no, y dice cuantas son", () => {
    // "No se puede borrar" sin numero obliga a ir a buscar.
    const result = canDeleteRole(role({ members: 3 }));

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain("3 personas");
  });

  it("con una sola persona, en singular", () => {
    const result = canDeleteRole(role({ members: 1 }));

    expect(result.ok === false && result.error).toContain("1 persona con");
  });

  it("uno de sistema, nunca", () => {
    expect(canDeleteRole(role({ systemRole: "member", members: 0 })).ok).toBe(false);
  });
});

describe("marcar un modulo entero (F71)", () => {
  const moduleKeys = ["contacts.view", "contacts.edit", "contacts.import"];

  it("marcar agrega los que faltan sin duplicar", () => {
    expect(toggleModule(["contacts.view", "flows.view"], moduleKeys, true).sort()).toEqual([
      "contacts.edit",
      "contacts.import",
      "contacts.view",
      "flows.view",
    ]);
  });

  it("desmarcar saca solo los del modulo", () => {
    expect(toggleModule(["contacts.view", "flows.view"], moduleKeys, false)).toEqual(["flows.view"]);
  });

  it("el estado del modulo distingue todos, algunos y ninguno", () => {
    expect(moduleState(moduleKeys, moduleKeys)).toBe("all");
    expect(moduleState(["contacts.view"], moduleKeys)).toBe("some");
    expect(moduleState(["flows.view"], moduleKeys)).toBe("none");
  });
});

describe("como se muestran (F71)", () => {
  it("los de sistema van primero, en su orden", () => {
    const sorted = sortRoles([
      role({ name: "Setter", systemRole: null }),
      role({ name: "Member", systemRole: "member" }),
      role({ name: "Owner", systemRole: "owner" }),
      role({ name: "Admin", systemRole: "admin" }),
    ]);

    expect(sorted.map((r) => r.name)).toEqual(["Owner", "Admin", "Member", "Setter"]);
  });

  it("los personalizados se ordenan alfabeticamente", () => {
    const sorted = sortRoles([role({ name: "Zeta" }), role({ name: "Alfa" })]);

    expect(sorted.map((r) => r.name)).toEqual(["Alfa", "Zeta"]);
  });

  it("la descripcion dice cuantos permisos y el alcance", () => {
    expect(
      describeRole(
        role({
          permissions: { keys: ["contacts.view", "contacts.edit"], scopes: { leads: "all", conversations: "own", bookings: "own", calls: "own" } },
        }),
      ),
    ).toBe("2 permisos · todos los leads");
  });

  it("el alcance 'los suyos + los sin asignar' se nombra", () => {
    expect(
      describeRole(
        role({ permissions: { keys: ["contacts.view"], scopes: { leads: "own_unassigned", conversations: "own", bookings: "own", calls: "own" } } }),
      ),
    ).toBe("1 permiso · sus leads y los sin asignar");
  });

  it("los de sistema se describen por lo que son", () => {
    expect(describeRole(role({ systemRole: "owner" }))).toContain("Puede todo.");
    expect(describeRole(role({ systemRole: "admin" }))).toContain("menos transferir");
  });

  it("uno vacio lo dice", () => {
    expect(
      describeRole(role({ permissions: { keys: [], scopes: { leads: "own", conversations: "own", bookings: "own", calls: "own" } } })),
    ).toBe("Sin permisos.");
  });
});

describe("los roles de sistema no cambian de comportamiento (F71)", () => {
  it("el Member sigue siendo el que fija la caracterizacion", () => {
    // Si este test falla, alguien cambio los permisos de Member sin
    // decidirlo: la tabla es la fuente y se deriva de member-baseline.
    expect(SYSTEM_ROLE_PERMISSIONS.member.scopes.leads).toBe("own");
    expect(SYSTEM_ROLE_PERMISSIONS.member.keys).toContain("content.create");
    expect(SYSTEM_ROLE_PERMISSIONS.member.keys).not.toContain("content.publish");
  });
});
