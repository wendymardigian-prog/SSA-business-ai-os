/**
 * Plantillas de rol (Equipo y roles, F14, plano §10.4). Son código, no una tabla.
 *
 * "Nuevo rol → Empezar desde" las usa. Una plantilla se filtra con `assertCanGrant` de quien crea:
 * nadie arma, desde una plantilla, un rol con más de lo que él mismo tiene.
 */
import { NO_CHANNELS, type ChannelsConfig } from "@/lib/auth/channel-permissions";
import { ALL_PERMISSION_KEYS, SCOPED_MODULES, type PermissionScope, type RolePermissions, type ScopedModule } from "@/lib/auth/permissions";
import { assertCanGrant, type GrantActor } from "@/lib/team/grant";

export interface RoleTemplate {
  id: "blank" | "setter" | "closer" | "content" | "leader";
  name: string;
  description: string;
  keys: string[];
  scopes: Partial<Record<ScopedModule, PermissionScope>>;
  /**
   * La bandeja. Las plantillas nacen en "todas las cuentas" (también las que se conecten después);
   * para separar cuentas se pasa a "elegir por cuenta" en el editor.
   */
  channels: ChannelsConfig;
}

const SETTER_KEYS = [
  "dashboards.chat.view",
  "contacts.view", "contacts.edit", "contacts.assign",
  "scheduling.use", "bookings.view", "bookings.manage",
  "forms.view", // @plantilla-quitar(formularios)
  "tasks.view", "tasks.edit", // @plantilla-quitar(tareas)
];

const CLOSER_KEYS = [
  "contacts.view", "contacts.edit",
  "scheduling.use", "bookings.view", "bookings.manage",
  "calls.view", "calls.edit", // @plantilla-quitar(llamadas)
  "sales.view", "sales.manage", "payments.manage", // @plantilla-quitar(ventas)
  "tasks.view", "tasks.edit", // @plantilla-quitar(tareas)
];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  { id: "blank", name: "En blanco", description: "Sin ningún permiso: los elegís vos.", keys: [], scopes: {}, channels: NO_CHANNELS },
  {
    id: "setter",
    name: "Setter",
    description: "Contesta los chats, atiende a los contactos y agenda reuniones.",
    keys: SETTER_KEYS,
    scopes: { leads: "own_unassigned", bookings: "own", calls: "own", sales: "own", commissions: "own", tasks: "own" }, // @plantilla-quitar(llamadas,ventas,comisiones,tareas)
    // @plantilla-sin(llamadas,ventas,comisiones,tareas): scopes: { leads: "own_unassigned", bookings: "own" },
    channels: { mode: "all", all: { scope: "own_unassigned", reply: true } },
  },
  {
    id: "closer",
    name: "Closer",
    description: "Hace las llamadas de venta, carga las ventas y cobra.",
    keys: CLOSER_KEYS,
    scopes: { leads: "own", bookings: "own", calls: "own", sales: "own", commissions: "own", tasks: "own" }, // @plantilla-quitar(llamadas,ventas,comisiones,tareas)
    // @plantilla-sin(llamadas,ventas,comisiones,tareas): scopes: { leads: "own", bookings: "own" },
    channels: { mode: "all", all: { scope: "own", reply: true } },
  },
  {
    id: "content",
    name: "Content Manager",
    description: "Crea, aprueba y publica contenido, y ve cómo rinde.",
    keys: [
      "dashboards.content.view", "social.view",
      "content.view", "content.create", "content.approve", "content.publish", "content.ai",
      "templates.manage",
      "tasks.view", "tasks.edit", // @plantilla-quitar(tareas)
    ],
    scopes: { leads: "own", bookings: "own", calls: "own", sales: "own", commissions: "own", tasks: "own" }, // @plantilla-quitar(llamadas,ventas,comisiones,tareas)
    // @plantilla-sin(llamadas,ventas,comisiones,tareas): scopes: { leads: "own", bookings: "own" },
    channels: NO_CHANNELS,
  },
  {
    id: "leader",
    name: "Líder de equipo",
    description: "Todo lo del Setter y el Closer, y ve a todo el equipo.",
    keys: [...new Set([...SETTER_KEYS, ...CLOSER_KEYS, "team.view", "eod.view_all", "dashboards.agenda.view", "data.export", "tasks.delete"])], // @plantilla-quitar(formularios,tareas)
    // @plantilla-sin(formularios,tareas): keys: [...new Set([...SETTER_KEYS, ...CLOSER_KEYS, "team.view", "dashboards.agenda.view", "data.export"])],
    scopes: { leads: "all", bookings: "all", calls: "all", sales: "all", commissions: "all", tasks: "all" }, // @plantilla-quitar(llamadas,ventas,comisiones,tareas)
    // @plantilla-sin(llamadas,ventas,comisiones,tareas): scopes: { leads: "all", bookings: "all" },
    channels: { mode: "all", all: { scope: "all", reply: true } },
  },
];

export function templateById(id: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Los permisos con los que arranca un rol creado desde esta plantilla: solo lo que `actor` puede dar.
 * Lo que no puede dar se saca (y se cuenta, para avisar).
 */
export function applyTemplate(
  template: RoleTemplate,
  actor: GrantActor,
): { permissions: RolePermissions; dropped: number } {
  const keys = template.keys.filter((key) => assertCanGrant(actor, { keys: [key] }).ok);

  const scopes = Object.fromEntries(SCOPED_MODULES.map((m) => [m, "own"])) as Record<ScopedModule, PermissionScope>;
  for (const scoped of SCOPED_MODULES) {
    const wanted = template.scopes[scoped];
    if (wanted && assertCanGrant(actor, { keys: [], scopes: { [scoped]: wanted } }).ok) scopes[scoped] = wanted;
  }
  // La bandeja va entera o no va: una plantilla que da "todas las cuentas" a alguien que no las tiene
  // arranca sin cuentas (y se cuenta como algo que no se pudo dar).
  const channelsOk = assertCanGrant(actor, { keys: [], channels: { wanted: template.channels, before: null } }).ok;
  const channels = channelsOk ? template.channels : NO_CHANNELS;
  const droppedChannels = channelsOk ? 0 : 1;
  return { permissions: { keys, scopes, channels }, dropped: template.keys.length - keys.length + droppedChannels };
}

export const TEMPLATE_KEYS_ARE_VALID = ROLE_TEMPLATES.every((t) => t.keys.every((k) => ALL_PERMISSION_KEYS.includes(k)));
