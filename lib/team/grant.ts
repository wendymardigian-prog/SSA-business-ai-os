/**
 * "No podés dar lo que no tenés" (Equipo y roles, plano §12).
 *
 * Quien puede invitar, asignar un rol o editar un rol NO puede, por ese camino, darle a
 * nadie (ni a sí mismo) más de lo que tiene. Sin esta regla, un rol con `team.invite`
 * invitaría como Admin, y uno con `roles.manage` se armaría un rol con todo.
 *
 * Módulo PURO: no sabe de Supabase. Lo usan, con el mismo código, invitar, asignar un rol,
 * crear y editar roles (`patchRole`) y las plantillas. La base tiene su gemela
 * (`private.can_grant`, 00212) para el que arme el pedido a mano; los casos compartidos
 * viven en `grant.cases.json` y corren contra las dos.
 *
 * Reglas:
 *  - Un Admin (rol de sistema) solo lo da un Owner o un Admin.
 *  - El Owner no se da: es único y se transfiere, no se asigna.
 *  - Una clave `ownerOnly` o reservada no entra en un rol (la tiene el Owner y nadie más).
 *  - Para el resto: cada clave y cada alcance tienen que estar ya en poder de quien da.
 *  - Nadie cambia su propio rol (salvo Owner y Admin) ni edita el rol que tiene asignado.
 *  - Nadie toca al Owner.
 */
import {
  OWNER_ONLY_KEYS,
  PERMISSION_KEYS,
  SCOPED_MODULES,
  type PermissionScope,
  type RolePermissions,
  type ScopedModule,
} from "@/lib/auth/permissions";

export const CANNOT_GRANT_MESSAGE = "No podés dar permisos que no tenés.";

/** Quién está dando. `permissions` son los permisos ya resueltos de esa persona. */
export interface GrantActor {
  userId: string;
  role: "owner" | "admin" | "member";
  roleId: string | null;
  permissions: RolePermissions;
}

export type GrantDenial =
  | "missing_keys"
  | "scope_too_wide"
  | "owner_only_key"
  | "admin_role"
  | "owner_role"
  | "own_role"
  | "owner_member";

export type GrantResult =
  | { ok: true }
  | { ok: false; reason: GrantDenial; error: string; keys?: string[] };

const deny = (reason: GrantDenial, error: string, keys?: string[]): GrantResult => ({ ok: false, reason, error, keys });

const SCOPE_RANK: Record<PermissionScope, number> = { own: 0, own_unassigned: 1, all: 2 };

const isAdminLike = (actor: GrantActor) => actor.role === "owner" || actor.role === "admin";

const RESERVED_KEYS = PERMISSION_KEYS.filter((p) => p.reserved).map((p) => p.key);

/**
 * Si `actor` puede dar estas claves y estos alcances.
 *
 * Owner y Admin pueden dar todo lo que existe en el catálogo, MENOS las claves solo-Owner
 * y las reservadas: esas no viajan en un rol.
 */
export function assertCanGrant(
  actor: GrantActor,
  grant: { keys: string[]; scopes?: Partial<Record<ScopedModule, PermissionScope>> },
): GrantResult {
  const forbidden = grant.keys.filter((k) => OWNER_ONLY_KEYS.includes(k) || RESERVED_KEYS.includes(k));
  if (forbidden.length > 0) {
    return deny("owner_only_key", "Hay permisos que no se pueden incluir en un rol.", forbidden);
  }

  if (isAdminLike(actor)) return { ok: true };

  const missing = grant.keys.filter((k) => !actor.permissions.keys.includes(k));
  if (missing.length > 0) return deny("missing_keys", CANNOT_GRANT_MESSAGE, missing);

  for (const module of SCOPED_MODULES) {
    const wanted = grant.scopes?.[module];
    if (!wanted) continue;
    const mine = actor.permissions.scopes[module] ?? "own";
    if (SCOPE_RANK[wanted] > SCOPE_RANK[mine]) return deny("scope_too_wide", CANNOT_GRANT_MESSAGE);
  }
  return { ok: true };
}

/** Lo que cambia entre el rol de antes y el de después: lo único que hay que poder dar. */
export function diffGrant(
  before: RolePermissions | null,
  after: RolePermissions,
): { keys: string[]; scopes: Partial<Record<ScopedModule, PermissionScope>> } {
  const had = new Set(before?.keys ?? []);
  const scopes: Partial<Record<ScopedModule, PermissionScope>> = {};
  for (const module of SCOPED_MODULES) {
    const prev = before?.scopes[module] ?? "own";
    const next = after.scopes[module] ?? "own";
    if (SCOPE_RANK[next] > SCOPE_RANK[prev]) scopes[module] = next;
  }
  return { keys: after.keys.filter((k) => !had.has(k)), scopes };
}

/** El rol que se quiere dar o asignar. */
export interface RoleToGive {
  id: string | null;
  systemRole: "owner" | "admin" | "member" | null;
  permissions: RolePermissions;
}

/**
 * Si `actor` puede invitar con este rol o asignárselo a `target`.
 *
 * `target` es la persona que lo recibe (en una invitación todavía no existe: va `null`).
 */
export function assertCanAssignRole(
  actor: GrantActor,
  role: RoleToGive,
  target: { userId: string; memberRole: "owner" | "admin" | "member" } | null,
): GrantResult {
  if (role.systemRole === "owner") return deny("owner_role", "El rol de Owner no se asigna: la propiedad se transfiere.");
  if (target?.memberRole === "owner") return deny("owner_member", "No se puede cambiar el rol del Owner.");
  if (target && target.userId === actor.userId && !isAdminLike(actor)) {
    return deny("own_role", "No podés cambiarte el rol a vos mismo.");
  }
  if (role.systemRole === "admin") {
    return isAdminLike(actor) ? { ok: true } : deny("admin_role", CANNOT_GRANT_MESSAGE);
  }
  // Member de sistema y roles personalizados: lo que tiene el rol tiene que estar en poder de quien lo da.
  return assertCanGrant(actor, { keys: role.permissions.keys, scopes: role.permissions.scopes });
}

/**
 * Si `actor` puede cambiar este rol a lo que quedaría (`after`).
 *
 * Solo hay que poder dar lo que se AGREGA: sacar permisos de un rol nunca es una escalada.
 */
export function assertCanEditRole(
  actor: GrantActor,
  role: { id: string; systemRole: "owner" | "admin" | "member" | null; permissions: RolePermissions },
  after: RolePermissions,
): GrantResult {
  if (role.systemRole) return deny("own_role", "Los roles de sistema no se editan.");
  if (!isAdminLike(actor) && actor.roleId !== null && actor.roleId === role.id) {
    return deny("own_role", "No podés editar el rol que tenés asignado.");
  }
  const added = diffGrant(role.permissions, after);
  return assertCanGrant(actor, added);
}
