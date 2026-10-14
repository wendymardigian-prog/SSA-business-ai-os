import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_KEYS, OWNER_ONLY_KEYS, SYSTEM_ROLE_PERMISSIONS, type RolePermissions } from "@/lib/auth/permissions";
import { assertCanGrant, type GrantActor } from "@/lib/team/grant";
import { applyTemplate, ROLE_TEMPLATES, templateById, TEMPLATE_KEYS_ARE_VALID } from "./templates";

const actorOf = (role: "owner" | "admin" | "member", permissions?: RolePermissions): GrantActor => ({
  userId: "u",
  role,
  roleId: role === "member" ? "rol-x" : null,
  permissions: permissions ?? SYSTEM_ROLE_PERMISSIONS[role],
});

describe("plantillas de rol", () => {
  it("toda clave de plantilla existe en el catalogo, y ninguna es solo-Owner", () => {
    expect(TEMPLATE_KEYS_ARE_VALID).toBe(true);
    for (const t of ROLE_TEMPLATES) {
      for (const key of t.keys) {
        expect(ALL_PERMISSION_KEYS, `${t.id}: ${key}`).toContain(key);
        expect(OWNER_ONLY_KEYS).not.toContain(key);
      }
    }
  });

  it("son las cinco del plano (en blanco + Setter, Closer, Content Manager y Líder de equipo)", () => {
    expect(ROLE_TEMPLATES.map((t) => t.id)).toEqual(["blank", "setter", "closer", "content", "leader"]);
  });

  it("el Setter lleva los 6 de bandeja, contactos view/edit/assign y los contactos sin asignar", () => {
    const setter = templateById("setter")!;
    for (const k of ["inbox.instagram.view", "inbox.email.reply", "contacts.assign", "bookings.manage", "tasks.edit"]) expect(setter.keys).toContain(k);
    expect(setter.scopes.leads).toBe("own_unassigned");
  });

  it("el Líder de equipo es Setter + Closer + los extras, con alcance 'all'", () => {
    const leader = templateById("leader")!;
    for (const k of [...templateById("setter")!.keys, ...templateById("closer")!.keys, "team.view", "eod.view_all", "dashboards.agenda.view", "data.export", "tasks.delete"]) {
      expect(leader.keys).toContain(k);
    }
    expect(leader.scopes.leads).toBe("all");
  });

  it("un Owner o Admin crea desde la plantilla con TODAS sus claves", () => {
    for (const role of ["owner", "admin"] as const) {
      const { permissions, dropped } = applyTemplate(templateById("leader")!, actorOf(role));
      expect(dropped).toBe(0);
      expect(permissions.keys).toEqual(templateById("leader")!.keys);
      expect(permissions.scopes.leads).toBe("all");
    }
  });

  it("un rol con menos permisos solo recibe lo que puede dar (filtrado por assertCanGrant)", () => {
    const actor = actorOf("member", { keys: ["roles.manage", "contacts.view", "contacts.edit"], scopes: { ...SYSTEM_ROLE_PERMISSIONS.member.scopes, leads: "own" } });
    const { permissions, dropped } = applyTemplate(templateById("setter")!, actor);
    expect(permissions.keys.sort()).toEqual(["contacts.edit", "contacts.view"]);
    expect(dropped).toBeGreaterThan(0);
    // Y lo que recibe, EL MISMO lo puede dar: la plantilla nunca escala.
    expect(assertCanGrant(actor, { keys: permissions.keys, scopes: permissions.scopes })).toEqual({ ok: true });
    // El alcance mas ancho que el suyo no pasa.
    expect(permissions.scopes.leads).toBe("own");
  });

  it("'En blanco' no lleva ningun permiso", () => {
    expect(applyTemplate(templateById("blank")!, actorOf("admin")).permissions.keys).toEqual([]);
  });
});
