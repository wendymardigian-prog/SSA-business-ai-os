/**
 * El catalogo de permisos (F68).
 *
 * Lo que mas se cuida: que los permisos de Member sean los de hoy. La
 * caracterizacion (`member-baseline.test.ts`) fija lo que puede en el codigo
 * real; esto fija que la tabla diga lo mismo.
 */

import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "@/lib/nav/items";
import {
  ALL_PERMISSION_KEYS,
  can,
  canAll,
  canAny,
  isEmptyRole,
  parsePermissions,
  PERMISSION_KEYS,
  PERMISSION_MODULES,
  permissionLabel,
  permissionsOfModule,
  scopeFor,
  scopeOptionsFor,
  SYSTEM_ROLE_PERMISSIONS,
  systemRolePermissions,
} from "./permissions";

describe("el catalogo (F68)", () => {
  it("no hay claves repetidas", () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it("cada clave pertenece a un modulo del catalogo", () => {
    for (const permission of PERMISSION_KEYS) {
      expect(PERMISSION_MODULES, permission.key).toContain(permission.module);
    }
  });

  it("cada clave tiene etiqueta en castellano", () => {
    // La pantalla de roles la muestra tal cual: "inbox.whatsapp.reply" no le
    // dice nada a nadie.
    for (const permission of PERMISSION_KEYS) {
      expect(permission.label.length, permission.key).toBeGreaterThan(3);
      expect(permission.label).not.toContain(".");
    }
  });

  it("los modulos se pueden recorrer para armar la pantalla", () => {
    const total = PERMISSION_MODULES.flatMap((m) => permissionsOfModule(m)).length;

    expect(total).toBe(PERMISSION_KEYS.length);
  });

  it("una clave desconocida se muestra tal cual en vez de vacio", () => {
    expect(permissionLabel("telepatia.usar")).toBe("telepatia.usar");
  });
});

describe("los tres roles de sistema (F68)", () => {
  it("el Owner puede todo", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.owner.keys).toEqual(ALL_PERMISSION_KEYS);
  });

  it("el Admin puede todo menos transferir la propiedad", () => {
    // Es lo unico irreversible del sistema.
    expect(can(SYSTEM_ROLE_PERMISSIONS.admin, "workspace.transfer")).toBe(false);
    expect(SYSTEM_ROLE_PERMISSIONS.admin.keys).toHaveLength(ALL_PERMISSION_KEYS.length - 1);
  });

  it("Owner y Admin ven todo el negocio", () => {
    expect(scopeFor(SYSTEM_ROLE_PERMISSIONS.owner, "leads")).toBe("all");
    expect(scopeFor(SYSTEM_ROLE_PERMISSIONS.admin, "conversations")).toBe("all");
  });
});

describe("el Member es exactamente el de hoy (F68)", () => {
  const member = SYSTEM_ROLE_PERMISSIONS.member;

  it("ve solo lo suyo", () => {
    expect(scopeFor(member, "leads")).toBe("own");
    expect(scopeFor(member, "conversations")).toBe("own");
  });

  it("responde en los tres canales de la bandeja", () => {
    expect(
      canAll(member, [
        "inbox.instagram.reply",
        "inbox.whatsapp.reply",
        "inbox.email.reply",
      ]),
    ).toBe(true);
  });

  it("ve y edita contactos, pero no importa ni borra", () => {
    expect(canAll(member, ["contacts.view", "contacts.edit"])).toBe(true);
    expect(canAny(member, ["contacts.import", "contacts.delete"])).toBe(false);
  });

  it("edita flows y secuencias", () => {
    expect(canAll(member, ["flows.edit", "sequences.edit"])).toBe(true);
  });

  it("ve el dashboard de chat y ninguno de los otros dos", () => {
    expect(can(member, "dashboards.chat.view")).toBe(true);
    expect(canAny(member, ["dashboards.content.view", "dashboards.ads.view", "dashboards.agenda.view"])).toBe(false);
  });

  it("en contenido crea lo suyo, pero no aprueba ni programa ni usa la IA", () => {
    // Es el reparto que fija la caracterizacion: es lo que puede hoy.
    expect(canAll(member, ["content.view", "content.create"])).toBe(true);
    expect(canAny(member, ["content.approve", "content.publish", "content.ai"])).toBe(false);
  });

  it("ve el agente pero no lo edita ni ve los costos", () => {
    expect(can(member, "agents.view")).toBe(true);
    expect(canAny(member, ["agents.edit", "ai_costs.view"])).toBe(false);
  });

  it("no toca nada de configuracion", () => {
    expect(
      canAny(member, [
        "integrations.manage",
        "team.manage",
        "roles.manage",
        "settings.manage",
        "knowledge.edit",
        "social.view",
      ]),
    ).toBe(false);
  });

  it("coincide con lo que el menu le muestra hoy", () => {
    // Las entradas `adminOnly` del menu son justo las que el Member no tiene
    // permiso de ver.
    const adminOnly = NAV_ITEMS.filter((i) => i.adminOnly).map((i) => i.name);

    expect(adminOnly).toContain("Conocimiento");
    expect(can(member, "knowledge.view")).toBe(false);

    // Social dejo de ser por cargo (F78): se ve con el permiso `social.view`,
    // y el Member de sistema no lo tiene, asi que sigue sin verlo.
    const social = NAV_ITEMS.find((i) => i.name === "Social");
    expect(social?.adminOnly).toBe(false);
    expect(social?.permissions).toEqual(["social.view"]);
    expect(can(member, "social.view")).toBe(false);
  });
});

describe("agenda: los permisos de la Etapa 4 (F2)", () => {
  const member = SYSTEM_ROLE_PERMISSIONS.member;

  it("el Member tiene agenda propia y ve y gestiona solo las suyas", () => {
    expect(canAll(member, ["scheduling.use", "bookings.view", "bookings.manage"])).toBe(true);
    expect(scopeFor(member, "bookings")).toBe("own");
    expect(canAny(member, ["scheduling.manage_others", "scheduling.manage_categories", "scheduling.team_events"])).toBe(false);
  });

  it("Owner y Admin tienen las seis claves con alcance a todas las agendas", () => {
    for (const role of [SYSTEM_ROLE_PERMISSIONS.owner, SYSTEM_ROLE_PERMISSIONS.admin]) {
      expect(
        canAll(role, [
          "scheduling.use",
          "scheduling.manage_others",
          "scheduling.team_events",
          "scheduling.manage_categories",
          "bookings.view",
          "bookings.manage",
        ]),
      ).toBe(true);
      expect(scopeFor(role, "bookings")).toBe("all");
    }
  });

  it("un rol guardado sin el alcance de agendas queda en own", () => {
    const parsed = parsePermissions({ keys: ["bookings.view"], scopes: { leads: "all" } });
    expect(parsed.scopes.bookings).toBe("own");
    expect(parsePermissions({ keys: [], scopes: { bookings: "all" } }).scopes.bookings).toBe("all");
  });
});

describe("preguntar por un permiso (F68)", () => {
  const role = SYSTEM_ROLE_PERMISSIONS.member;

  it("una clave que no existe siempre da false", () => {
    // Un permiso mal escrito no puede abrir una puerta, y renombrar una
    // clave cierra el acceso en vez de abrirlo.
    expect(can(role, "telepatia.usar")).toBe(false);
    expect(can({ keys: ["telepatia.usar"], scopes: { leads: "all", conversations: "all", bookings: "all", calls: "own" } }, "telepatia.usar")).toBe(false);
  });

  it("sin rol, nada", () => {
    expect(can(null, "contacts.view")).toBe(false);
    expect(scopeFor(undefined, "leads")).toBe("own");
  });

  it("canAny alcanza con uno; canAll pide todos", () => {
    expect(canAny(role, ["contacts.delete", "contacts.view"])).toBe(true);
    expect(canAll(role, ["contacts.delete", "contacts.view"])).toBe(false);
  });

  it("canAll con una lista vacia es false: no significa 'puede todo'", () => {
    expect(canAll(role, [])).toBe(false);
  });
});

describe("leer un rol guardado (F68)", () => {
  it("las claves que ya no existen se descartan", () => {
    // Una clave vieja no puede dejar a alguien sin poder entrar.
    const parsed = parsePermissions({ keys: ["contacts.view", "clave.vieja"] });

    expect(parsed.keys).toEqual(["contacts.view"]);
  });

  it("un alcance invalido cae al mas restrictivo", () => {
    expect(parsePermissions({ scopes: { leads: "todos" } }).scopes.leads).toBe("own");
    expect(parsePermissions({ scopes: { leads: "all" } }).scopes.leads).toBe("all");
  });

  it("'own_unassigned' (los suyos + los sin asignar) solo existe para los leads (00136)", () => {
    const parsed = parsePermissions({ scopes: { leads: "own_unassigned", conversations: "own_unassigned", bookings: "own_unassigned" } });
    expect(parsed.scopes.leads).toBe("own_unassigned");
    // En conversaciones y agendas no significa nada: se trata como 'own', lo mas angosto.
    expect(parsed.scopes.conversations).toBe("own");
    expect(parsed.scopes.bookings).toBe("own");
    expect(scopeOptionsFor("leads")).toEqual(["own", "own_unassigned", "all"]);
    expect(scopeOptionsFor("conversations")).toEqual(["own", "all"]);
    expect(scopeOptionsFor("bookings")).toEqual(["own", "all"]);
  });

  it("el Member de sistema ve solo los suyos: los sin asignar son una decision del rol, no del Member", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.member.scopes.leads).toBe("own");
  });

  it("lo que no tiene la forma esperada da un rol vacio, no un error", () => {
    expect(parsePermissions(null).keys).toEqual([]);
    expect(parsePermissions("texto").keys).toEqual([]);
    expect(parsePermissions({ keys: "no soy lista" }).keys).toEqual([]);
  });

  it("un rol sin permisos se puede detectar para advertirlo", () => {
    expect(isEmptyRole(parsePermissions({}))).toBe(true);
    expect(isEmptyRole(SYSTEM_ROLE_PERMISSIONS.member)).toBe(false);
  });
});

describe("los roles de sistema por nombre (F68)", () => {
  it("se resuelven los tres", () => {
    for (const role of ["owner", "admin", "member"]) {
      expect(systemRolePermissions(role), role).not.toBeNull();
    }
  });

  it("un rol personalizado no es de sistema", () => {
    expect(systemRolePermissions("Setter senior")).toBeNull();
  });
});
