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
  CHANNEL_SCOPE_LABELS,
  hasAnyChannel,
  NO_CHANNELS,
  type ChannelsConfig,
} from "./channel-permissions";
import {
  ALL_PERMISSION_KEYS,
  isEmptyRole,
  parsePermissions,
  SCOPED_MODULES,
  scopeOptionsFor,
  SCOPE_LABELS,
  type PermissionScope,
  type RolePermissions,
  type ScopedModule,
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
  /** La bandeja por cuenta. Sin esto, el rol no ve ninguna cuenta. */
  channels?: ChannelsConfig;
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
      bookings: input.scopes.bookings ?? "own",
      calls: input.scopes.calls ?? "own",
      sales: input.scopes.sales ?? "own",
      commissions: input.scopes.commissions ?? "own",
      tasks: input.scopes.tasks ?? "own",
    },
    // `parsePermissions` normaliza: "responder" sin un alcance no existe (un permiso de cuenta siempre trae
    // "que conversaciones ve"), y un valor que no se entiende es "sin acceso".
    channels: input.channels ?? NO_CHANNELS,
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
 * El boton "todos" por modulo existe porque la lista tiene setenta y dos
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

const SCOPE_SHORT: Record<PermissionScope, { masc: string; fem: string }> = {
  own: { masc: "solo los suyos", fem: "solo las suyas" },
  own_unassigned: { masc: "los suyos + los sin asignar", fem: "las suyas + las sin asignar" },
  all: { masc: "todos", fem: "todas" },
};

/**
 * Lo que se muestra debajo del nombre: cuantos permisos, el alcance de contactos y la bandeja
 * («21 permisos · contactos: todos · bandeja: todas las cuentas»).
 */
export function describeRole(role: RoleRow): string {
  if (role.systemRole === "owner") return "Puede todo.";
  if (role.systemRole === "admin") return "Puede todo menos transferir la propiedad y quitar personas.";

  const count = role.permissions.keys.length;
  if (count === 0 && !hasAnyChannel(role.permissions.channels)) return "Sin permisos.";
  const leads = SCOPE_SHORT[role.permissions.scopes.leads].masc;
  return `${count} ${count === 1 ? "permiso" : "permisos"} · contactos: ${leads} · bandeja: ${describeChannels(role.permissions.channels)}`;
}

/** La bandeja en pocas palabras: «todas las cuentas (solo asignadas)», «2 cuentas» o «ninguna cuenta». */
export function describeChannels(channels: ChannelsConfig): string {
  if (channels.mode === "all") return `todas las cuentas (${CHANNEL_SCOPE_LABELS[channels.all.scope].toLowerCase()})`;
  const n = Object.keys(channels.byChannel).length;
  if (n === 0) return "ninguna cuenta";
  return n === 1 ? "1 cuenta" : `${n} cuentas`;
}

// ── Pantalla de roles: alcances dentro de cada grupo y tildes que se arrastran (B3) ─────────────


/** Qué permiso de "ver" gobierna el alcance de cada módulo, y qué dice el aviso cuando falta. */
const SCOPE_GATES: Record<ScopedModule, { keys: string[]; label: string; hint: string; hintSelector: string }> = {
  leads: { keys: ["contacts.view"], label: "Qué contactos ve", hint: "Activá «Ver contactos» para elegir el alcance", hintSelector: "contacts.view" },
  bookings: { keys: ["bookings.view"], label: "Qué agendas ve", hint: "Activá «Ver agendas» para elegir el alcance", hintSelector: "bookings.view" },
  calls: { keys: ["calls.view"], label: "Qué llamadas ve", hint: "Activá «Ver las llamadas» para elegir el alcance", hintSelector: "calls.view" },
  sales: { keys: ["sales.view"], label: "Qué ventas ve", hint: "Activá «Ver las ventas» para elegir el alcance", hintSelector: "sales.view" },
  commissions: { keys: ["commissions.view"], label: "Qué comisiones ve", hint: "Activá «Ver comisiones» para elegir el alcance", hintSelector: "commissions.view" },
  tasks: { keys: ["tasks.view"], label: "Qué tareas ve", hint: "Activá «Ver las tareas» para elegir el alcance", hintSelector: "tasks.view" },
};

/** En qué grupo de la pantalla va el selector de cada alcance. */
export const SCOPE_GROUP: Record<ScopedModule, string> = {
  leads: "contacts",
  bookings: "scheduling",
  calls: "calls",
  sales: "sales",
  commissions: "commissions",
  tasks: "tasks",
};

export interface ScopeFieldState {
  label: string;
  enabled: boolean;
  /** Qué decir cuando está deshabilitado. */
  hint: string | null;
  options: Array<{ value: PermissionScope; label: string }>;
}

/**
 * El estado del selector de alcance de un módulo: habilitado solo si el rol puede VER eso. Sin el
 * permiso de ver, elegir un alcance no cambia nada y confunde.
 */
export function scopeFieldState(module: ScopedModule, keys: string[]): ScopeFieldState {
  const gate = SCOPE_GATES[module];
  const enabled = gate.keys.some((k) => keys.includes(k));
  return {
    label: gate.label,
    enabled,
    hint: enabled ? null : gate.hint,
    options: scopeOptionsFor(module).map((value) => ({ value, label: SCOPE_LABELS[value] })),
  };
}

/** Pares ver ⇒ editar/responder: tildar lo segundo tilda lo primero, y destildar lo primero destilda lo segundo. */
const IMPLIES: Array<[view: string, dependent: string]> = [
  ["contacts.view", "contacts.edit"],
  ["flows.view", "flows.edit"],
  // Publicar escribe los disparadores del flujo, y la base los deja escribir con `flows.edit` (00214).
  ["flows.edit", "flows.publish"],
  ["sequences.view", "sequences.edit"],
  ["agents.view", "agents.edit"],
  ["knowledge.view", "knowledge.edit"],
  ["content.view", "content.create"],
];

/**
 * Tildar o destildar UNA clave, con sus correcciones automáticas aplicadas en el momento (la
 * pantalla las muestra al instante, no al guardar). Devuelve las claves resultantes y cuáles se
 * agregaron o quitaron de arrastre.
 */
export function applyKeyToggle(
  keys: string[],
  key: string,
  on: boolean,
): { keys: string[]; alsoAdded: string[]; alsoRemoved: string[] } {
  const set = new Set(keys);
  const alsoAdded: string[] = [];
  const alsoRemoved: string[] = [];

  // Con cierre en cadena: tildar «publicar» tilda «editar» y, por eso, tambien «ver»; destildar «ver» destilda «editar» y «publicar».
  if (on) {
    set.add(key);
    const queue = [key];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const [view, dependent] of IMPLIES) {
        if (dependent === current && !set.has(view)) {
          set.add(view);
          alsoAdded.push(view);
          queue.push(view);
        }
      }
    }
  } else {
    set.delete(key);
    const queue = [key];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const [view, dependent] of IMPLIES) {
        if (view === current && set.has(dependent)) {
          set.delete(dependent);
          alsoRemoved.push(dependent);
          queue.push(dependent);
        }
      }
    }
  }
  return { keys: [...set], alsoAdded, alsoRemoved };
}

/** `eod.view_all` se muestra como un selector («Qué reportes de fin de día ve»), no como una casilla. */
export function eodSelectorValue(keys: string[]): "own" | "all" {
  return keys.includes("eod.view_all") ? "all" : "own";
}
