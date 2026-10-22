import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_PERMISSIONS, type RolePermissions } from "@/lib/auth/permissions";
import {
  assertCanAssignRole,
  assertCanEditRole,
  assertCanGrant,
  CANNOT_GRANT_MESSAGE,
  diffGrant,
  type GrantActor,
  type RoleToGive,
} from "./grant";

const perms = (keys: string[], scopes: Partial<RolePermissions["scopes"]> = {}): RolePermissions => ({
  keys,
  scopes: { leads: "own", bookings: "own", calls: "own", sales: "own", commissions: "own", tasks: "own", ...scopes },
  channels: { mode: "custom", byChannel: {} },
});

const owner: GrantActor = { userId: "owner", role: "owner", roleId: null, permissions: SYSTEM_ROLE_PERMISSIONS.owner };
const admin: GrantActor = { userId: "admin", role: "admin", roleId: null, permissions: SYSTEM_ROLE_PERMISSIONS.admin };
const member: GrantActor = { userId: "member", role: "member", roleId: null, permissions: SYSTEM_ROLE_PERMISSIONS.member };
const custom = (keys: string[], scopes: Partial<RolePermissions["scopes"]> = {}, id = "rol-x"): GrantActor => ({
  userId: "custom", role: "member", roleId: id, permissions: perms(keys, scopes),
});

const adminRole: RoleToGive = { id: "r-admin", systemRole: "admin", permissions: perms([]) };
const ownerRole: RoleToGive = { id: "r-owner", systemRole: "owner", permissions: perms([]) };
const memberRole: RoleToGive = { id: "r-member", systemRole: "member", permissions: SYSTEM_ROLE_PERMISSIONS.member };
const customRole = (keys: string[], scopes: Partial<RolePermissions["scopes"]> = {}): RoleToGive => ({
  id: "r-custom", systemRole: null, permissions: perms(keys, scopes),
});

describe("assertCanGrant", () => {
  it("Owner y Admin dan cualquier clave de un rol", () => {
    for (const actor of [owner, admin]) {
      expect(assertCanGrant(actor, { keys: ["contacts.view", "team.invite"], scopes: { leads: "all" } })).toEqual({ ok: true });
    }
  });

  it("nadie mete una clave solo-Owner o reservada en un rol, ni el Owner", () => {
    for (const actor of [owner, admin]) {
      const r = assertCanGrant(actor, { keys: ["team.remove"] });
      expect(r).toMatchObject({ ok: false, reason: "owner_only_key" });
      expect(assertCanGrant(actor, { keys: ["workspace.transfer"] })).toMatchObject({ ok: false });
      expect(assertCanGrant(actor, { keys: ["scheduling.team_events"] })).toMatchObject({ ok: false });
    }
  });

  it("un rol personalizado solo da las claves que tiene", () => {
    const actor = custom(["team.invite", "contacts.view"]);
    expect(assertCanGrant(actor, { keys: ["contacts.view"] })).toEqual({ ok: true });
    expect(assertCanGrant(actor, { keys: ["contacts.view", "contacts.delete"] })).toEqual({
      ok: false, reason: "missing_keys", error: CANNOT_GRANT_MESSAGE, keys: ["contacts.delete"],
    });
  });

  it("no da un alcance más ancho que el suyo", () => {
    const actor = custom(["contacts.view"], { leads: "own" });
    expect(assertCanGrant(actor, { keys: [], scopes: { leads: "own" } })).toEqual({ ok: true });
    expect(assertCanGrant(actor, { keys: [], scopes: { leads: "own_unassigned" } })).toMatchObject({ ok: false, reason: "scope_too_wide" });
    expect(assertCanGrant(actor, { keys: [], scopes: { leads: "all" } })).toMatchObject({ ok: false, reason: "scope_too_wide" });
    expect(assertCanGrant(custom([], { leads: "own_unassigned" }), { keys: [], scopes: { leads: "all" } })).toMatchObject({ ok: false });
    expect(assertCanGrant(custom([], { leads: "all" }), { keys: [], scopes: { leads: "all", tasks: "own" } })).toEqual({ ok: true });
  });

  it("el Member de sistema no da nada que no tenga", () => {
    expect(assertCanGrant(member, { keys: ["contacts.import"] })).toMatchObject({ ok: false });
    expect(assertCanGrant(member, { keys: ["contacts.view"] })).toEqual({ ok: true });
  });
});

describe("casos de ataque (plano §12)", () => {
  it("un rol con team.invite invita como Admin", () => {
    const actor = custom(["team.view", "team.invite"]);
    expect(assertCanAssignRole(actor, adminRole, null)).toMatchObject({ ok: false, reason: "admin_role", error: CANNOT_GRANT_MESSAGE });
  });

  it("un rol con team.invite invita con un rol más poderoso que el suyo", () => {
    const actor = custom(["team.invite", "contacts.view"]);
    expect(assertCanAssignRole(actor, customRole(["contacts.view", "contacts.delete"]), null)).toMatchObject({ ok: false, reason: "missing_keys" });
    expect(assertCanAssignRole(actor, customRole(["contacts.view"]), null)).toEqual({ ok: true });
  });

  it("un rol con team.invite invita con el Member de sistema solo si tiene todo lo del Member", () => {
    expect(assertCanAssignRole(custom(["team.invite"]), memberRole, null)).toMatchObject({ ok: false });
    // Todo lo del Member incluye su bandeja (todas las cuentas, solo lo asignado, responde: 00249).
    expect(assertCanAssignRole(custom([...SYSTEM_ROLE_PERMISSIONS.member.keys]), memberRole, null)).toMatchObject({ ok: false });
    const conBandeja = custom([...SYSTEM_ROLE_PERMISSIONS.member.keys]);
    conBandeja.permissions = { ...conBandeja.permissions, channels: SYSTEM_ROLE_PERMISSIONS.member.channels };
    expect(assertCanAssignRole(conBandeja, memberRole, null)).toEqual({ ok: true });
  });

  it("un rol con un solo Instagram no invita con un rol que tiene el otro (00249)", () => {
    const actor = custom(["team.invite", "contacts.view"]);
    actor.permissions = { ...actor.permissions, channels: { mode: "custom", byChannel: { "ig-1": { scope: "all", reply: true } } } };
    const conOtro = customRole(["contacts.view"]);
    conOtro.permissions = { ...conOtro.permissions, channels: { mode: "custom", byChannel: { "ig-2": { scope: "own", reply: false } } } };
    expect(assertCanAssignRole(actor, conOtro, null)).toMatchObject({ ok: false });
    conOtro.permissions = { ...conOtro.permissions, channels: { mode: "custom", byChannel: { "ig-1": { scope: "own", reply: true } } } };
    expect(assertCanAssignRole(actor, conOtro, null)).toEqual({ ok: true });
  });

  it("un rol con roles.manage le agrega a otro rol una clave que él no tiene", () => {
    const actor = custom(["roles.manage", "contacts.view"], {}, "mi-rol");
    const rol = { id: "otro", systemRole: null, permissions: perms(["contacts.view"]) };
    expect(assertCanEditRole(actor, rol, perms(["contacts.view", "flows.publish"]))).toMatchObject({ ok: false, reason: "missing_keys", keys: ["flows.publish"] });
    // Una clave que SÍ tiene, la puede dar.
    expect(assertCanEditRole(actor, rol, perms(["contacts.view", "roles.manage"]))).toEqual({ ok: true });
  });

  it("un rol con roles.manage edita su propio rol", () => {
    const actor = custom(["roles.manage"], {}, "mi-rol");
    const rol = { id: "mi-rol", systemRole: null, permissions: perms(["roles.manage"]) };
    expect(assertCanEditRole(actor, rol, perms(["roles.manage", "team.invite"]))).toMatchObject({ ok: false, reason: "own_role" });
    // Ni siquiera para sacarse permisos: es el rol que tiene asignado.
    expect(assertCanEditRole(actor, rol, perms([]))).toMatchObject({ ok: false, reason: "own_role" });
  });

  it("un rol con team.manage se asigna a sí mismo otro rol", () => {
    const actor = custom(["team.manage", "contacts.view"]);
    expect(
      assertCanAssignRole(actor, customRole(["contacts.view"]), { userId: actor.userId, memberRole: "member" }),
    ).toMatchObject({ ok: false, reason: "own_role" });
  });

  it("nadie asigna el rol de Owner, y nadie toca al Owner", () => {
    for (const actor of [owner, admin, custom(["team.manage"])]) {
      expect(assertCanAssignRole(actor, ownerRole, { userId: "otro", memberRole: "member" })).toMatchObject({ ok: false, reason: "owner_role" });
      expect(assertCanAssignRole(actor, customRole([]), { userId: "el-owner", memberRole: "owner" })).toMatchObject({ ok: false, reason: "owner_member" });
    }
  });

  it("Admin y Owner SÍ asignan Admin y roles personalizados a otras personas", () => {
    for (const actor of [owner, admin]) {
      expect(assertCanAssignRole(actor, adminRole, { userId: "otro", memberRole: "member" })).toEqual({ ok: true });
      expect(assertCanAssignRole(actor, customRole(["contacts.view", "flows.publish"]), { userId: "otro", memberRole: "member" })).toEqual({ ok: true });
    }
  });

  it("nadie se cambia su propio rol, tampoco un Admin (plano §4)", () => {
    expect(assertCanAssignRole(admin, customRole([]), { userId: admin.userId, memberRole: "admin" })).toMatchObject({ ok: false, reason: "own_role" });
    // El Owner tampoco: ademas de ser su propio rol, es el Owner (nadie lo toca).
    expect(assertCanAssignRole(owner, customRole([]), { userId: owner.userId, memberRole: "owner" })).toMatchObject({ ok: false });
  });

  it("un Admin y un Owner SÍ editan roles personalizados aunque ninguno sea el suyo", () => {
    const rol = { id: "otro", systemRole: null, permissions: perms(["contacts.view"]) };
    for (const actor of [owner, admin]) {
      expect(assertCanEditRole(actor, rol, perms(["contacts.view", "flows.publish"]))).toEqual({ ok: true });
    }
  });

  it("los roles de sistema no se editan", () => {
    const sys = { id: "x", systemRole: "member" as const, permissions: SYSTEM_ROLE_PERMISSIONS.member };
    expect(assertCanEditRole(owner, sys, SYSTEM_ROLE_PERMISSIONS.member)).toMatchObject({ ok: false });
  });
});

describe("assertCanEditRole: solo hay que poder dar lo que se agrega", () => {
  it("quitar permisos de un rol que tiene claves que uno no tiene, está permitido", () => {
    const actor = custom(["roles.manage"], {}, "mi-rol");
    const rol = { id: "otro", systemRole: null, permissions: perms(["contacts.view", "contacts.delete"]) };
    expect(assertCanEditRole(actor, rol, perms(["contacts.view"]))).toEqual({ ok: true });
  });

  it("subir un alcance también es dar", () => {
    const actor = custom(["roles.manage"], { leads: "own" }, "mi-rol");
    const rol = { id: "otro", systemRole: null, permissions: perms([], { leads: "own" }) };
    expect(assertCanEditRole(actor, rol, perms([], { leads: "all" }))).toMatchObject({ ok: false, reason: "scope_too_wide" });
  });

  it("diffGrant ve claves nuevas y alcances que suben", () => {
    expect(diffGrant(perms(["a"], { leads: "own" }), perms(["a", "b"], { leads: "all", tasks: "own" }))).toEqual({ keys: ["b"], scopes: { leads: "all" } });
    expect(diffGrant(null, perms(["a"]))).toEqual({ keys: ["a"], scopes: {} });
  });
});
