/**
 * Crear, editar y borrar roles (F71).
 *
 * Todo lo que decide algo esta aca y es puro: si un nombre sirve, si un rol
 * se puede borrar, que permisos quedan. Las escrituras son de
 * `lib/actions/roles.ts`.
 *
 * Dos reglas que se repiten en todo el archivo:
 *
 * 1. **Los roles de sistema no se tocan.** Ni el nombre ni los permisos. Si
 *    alguien le saca un permiso al rol Admin, la mitad del sistema deja de
 *    andar sin que quede claro por que. El trigger de la base lo frena
 *    igual; esto lo frena antes, con un mensaje que se entiende.
 * 2. **Un rol con gente no se borra.** Se pide reasignarla primero. Borrarlo
 *    dejaria a esas personas sin permisos de un momento a otro, y lo
 *    descubrirían al no poder entrar.
 */

import {
  ALL_PERMISSION_KEYS,
  isEmptyRole,
  parsePermissions,
  SCOPED_MODULES,
  type PermissionScope,
  type RolePermissions,
} from "./permissions";

export const MAX_NAME_LENGTH = 40;
export const MAX_DESCRIPTION_LENGTH = 200;

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  systemRole: "owner" | "admin" | "member" | null;
  permissions: RolePermissions;
  /** Cuanta gente lo tiene. */
  members: number;
}

export type RoleCheck = { ok: true } | { ok: false; error: string };

export interface RoleInput {
  name: string;
  description?: string | null;
  keys: string[];
  scopes: Partial<Record<(typeof SCOPED_MODULES)[number], PermissionScope>>;
}

export interface ValidatedRole {
  name: string;
  description: string | null;
  permissions: RolePermissions;
  /** Avisos que no bloquean. */
  warnings: string[];
}

export type RoleValidation = { ok: true; role: ValidatedRole } | { ok: false; error: string };

/**
 * Valida lo que se quiere guardar.
 *
 * Las claves que no existen se descartan en silencio: pueden venir de una
 * version anterior de la pantalla, y rechazar todo el rol por una clave
 * vieja seria perder el trabajo de quien lo estaba armando.
 */
export function validateRole(input: RoleInput): RoleValidation {
  const name = input.name.trim();

  if (name.length < 2) return { ok: false, error: "El nombre del rol es muy corto" };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `El nombre no puede pasar de ${MAX_NAME_LENGTH} caracteres` };
  }

  // Un rol personalizado que se llame igual que uno de sistema haria
  // imposible saber cual es cual en el selector del equipo.
  if (["owner", "admin", "member"].includes(name.toLowerCase())) {
    return { ok: false, error: `"${name}" es el nombre de un rol de sistema. Elegí otro.` };
  }

  const description = input.description?.trim() || null;
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `La descripcion no puede pasar de ${MAX_DESCRIPTION_LENGTH} caracteres` };
  }

  const permissions = parsePermissions({
    keys: input.keys,
    scopes: {
      leads: input.scopes.leads ?? "own",
      conversations: input.scopes.conversations ?? "own",
      bookings: input.scopes.bookings ?? "own",
      calls: input.scopes.calls ?? "own",
    },
  });

  const warnings: string[] = [];

  if (isEmptyRole(permissions)) {
    // No se bloquea: puede ser un rol en construccion. Pero se dice, porque
    // alguien con este rol no puede hacer nada y no va a entender por que.
    warnings.push("Este rol no tiene ningun permiso: quien lo tenga no va a poder hacer nada.");
  }

  const descartadas = input.keys.filter((key) => !ALL_PERMISSION_KEYS.includes(key));
  if (descartadas.length > 0) {
    warnings.push(`Se ignoraron ${descartadas.length} permiso(s) que ya no existen.`);
  }

  // Ver sin poder responder es una combinacion valida (alguien que supervisa),
  // pero responder sin poder ver no tiene sentido.
  for (const channel of ["instagram", "whatsapp", "email"]) {
    const puedeResponder = permissions.keys.includes(`inbox.${channel}.reply`);
    const puedeVer = permissions.keys.includes(`inbox.${channel}.view`);
    if (puedeResponder && !puedeVer) {
      warnings.push(
        `Marcaste "responder" en ${channel} sin "ver": se agrego "ver", porque sin eso no se llega a la conversacion.`,
      );
      permissions.keys.push(`inbox.${channel}.view`);
    }
  }

  // Lo mismo con editar sin ver.
  for (const [ver, editar] of [
    ["contacts.view", "contacts.edit"],
    ["flows.view", "flows.edit"],
    ["sequences.view", "sequences.edit"],
    ["agents.view", "agents.edit"],
    ["knowledge.view", "knowledge.edit"],
    ["content.view", "content.create"],
  ]) {
    if (permissions.keys.includes(editar) && !permissions.keys.includes(ver)) {
      permissions.keys.push(ver);
    }
  }

  return { ok: true, role: { name, description, permissions, warnings } };
}

/** Si ese rol se puede editar. */
export function canEditRole(role: Pick<RoleRow, "systemRole">): RoleCheck {
  if (role.systemRole) {
    return {
      ok: false,
      error: "Los roles de sistema no se editan. Creá un rol nuevo con los permisos que necesitás.",
    };
  }
  return { ok: true };
}

/**
 * Si ese rol se puede borrar.
 *
 * Con gente asignada, no: hay que reasignarla primero. El mensaje dice
 * cuantas son, porque "no se puede borrar" sin numero obliga a ir a buscar.
 */
export function canDeleteRole(role: Pick<RoleRow, "systemRole" | "members" | "name">): RoleCheck {
  if (role.systemRole) {
    return { ok: false, error: "Los roles de sistema no se borran." };
  }
  if (role.members > 0) {
    return {
      ok: false,
      error:
        role.members === 1
          ? `Hay 1 persona con el rol "${role.name}". Cambiale el rol antes de borrarlo.`
          : `Hay ${role.members} personas con el rol "${role.name}". Cambiales el rol antes de borrarlo.`,
    };
  }
  return { ok: true };
}

/**
 * Marcar o desmarcar todos los permisos de un modulo.
 *
 * El boton "todos" por modulo existe porque la lista tiene treinta y cinco
 * claves y armar un rol tildando de a una es tedioso.
 */
export function toggleModule(
  keys: string[],
  moduleKeys: string[],
  enable: boolean,
): string[] {
  if (enable) return [...new Set([...keys, ...moduleKeys])];
  return keys.filter((key) => !moduleKeys.includes(key));
}

/** Si todos los permisos de un modulo estan marcados. */
export function moduleState(
  keys: string[],
  moduleKeys: string[],
): "all" | "some" | "none" {
  const marked = moduleKeys.filter((key) => keys.includes(key)).length;
  if (marked === 0) return "none";
  return marked === moduleKeys.length ? "all" : "some";
}

/** Como se ordenan los roles en la pantalla: los de sistema primero. */
export function sortRoles(roles: RoleRow[]): RoleRow[] {
  const order: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  return [...roles].sort((a, b) => {
    const aOrder = a.systemRole ? order[a.systemRole] : 10;
    const bOrder = b.systemRole ? order[b.systemRole] : 10;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name);
  });
}

/** Lo que se muestra debajo del nombre: cuantos permisos y el alcance. */
export function describeRole(role: RoleRow): string {
  if (role.systemRole === "owner") return "Puede todo.";
  if (role.systemRole === "admin") return "Puede todo menos transferir la propiedad.";

  const count = role.permissions.keys.length;
  const scope =
    role.permissions.scopes.leads === "all"
      ? "todos los leads"
      : role.permissions.scopes.leads === "own_unassigned"
        ? "sus leads y los sin asignar"
        : "solo sus leads";

  if (count === 0) return "Sin permisos.";
  return `${count} ${count === 1 ? "permiso" : "permisos"} · ${scope}`;
}
