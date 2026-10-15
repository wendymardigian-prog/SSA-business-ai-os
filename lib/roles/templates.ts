/**
 * Plantillas de rol (Equipo y roles, F14, plano §10.4). Son código, no una tabla.
 *
 * "Nuevo rol → Empezar desde" las usa. Una plantilla se filtra con `assertCanGrant` de quien crea:
 * nadie arma, desde una plantilla, un rol con más de lo que él mismo tiene.
 */
import { ALL_PERMISSION_KEYS, SCOPED_MODULES, type PermissionScope, type RolePermissions, type ScopedModule } from "@/lib/auth/permissions";
import { assertCanGrant, type GrantActor } from "@/lib/team/grant";

export interface RoleTemplate {
  id: "blank" | "setter" | "closer" | "content" | "leader";
  name: string;
  description: string;
  keys: string[];
  scopes: Partial<Record<ScopedModule, PermissionScope>>;
}

const INBOX = [
  "inbox.instagram.view", "inbox.instagram.reply",
  "inbox.whatsapp.view", "inbox.whatsapp.reply",
  "inbox.email.view", "inbox.email.reply",
];

const SETTER_KEYS = [
  "dashboards.chat.view", ...INBOX,
  "contacts.view", "contacts.edit", "contacts.assign",
  "scheduling.use", "bookings.view", "bookings.manage",
  "forms.view", "tasks.view", "tasks.edit",
];

const CLOSER_KEYS = [
  ...INBOX,
  "contacts.view", "contacts.edit",
  "scheduling.use", "bookings.view", "bookings.manage",
  "calls.view", "calls.edit",
  "sales.view", "sales.manage", "payments.manage",
  "tasks.view", "tasks.edit",
];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  { id: "blank", name: "En blanco", description: "Sin ningún permiso: los elegís vos.", keys: [], scopes: {} },
  {
    id: "setter",
    name: "Setter",
    description: "Contesta los chats, atiende a los contactos y agenda reuniones.",
    keys: SETTER_KEYS,
    scopes: { leads: "own_unassigned", conversations: "own", bookings: "own", calls: "own", sales: "own", commissions: "own", tasks: "own" },
  },
  {
    id: "closer",
    name: "Closer",
    description: "Hace las llamadas de venta, carga las ventas y cobra.",
    keys: CLOSER_KEYS,
    scopes: { leads: "own", conversations: "own", bookings: "own", calls: "own", sales: "own", commissions: "own", tasks: "own" },
  },
  {
    id: "content",
    name: "Content Manager",
    description: "Crea, aprueba y publica contenido, y ve cómo rinde.",
    keys: [
      "dashboards.content.view", "social.view",
      "content.view", "content.create", "content.approve", "content.publish", "content.ai",
      "templates.manage", "tasks.view", "tasks.edit",
    ],
    scopes: { leads: "own", conversations: "own", bookings: "own", calls: "own", sales: "own", commissions: "own", tasks: "own" },
  },
  {
    id: "leader",
    name: "Líder de equipo",
    description: "Todo lo del Setter y el Closer, y ve a todo el equipo.",
    keys: [...new Set([...SETTER_KEYS, ...CLOSER_KEYS, "team.view", "eod.view_all", "dashboards.agenda.view", "data.export", "tasks.delete"])],
    scopes: { leads: "all", conversations: "all", bookings: "all", calls: "all", sales: "all", commissions: "all", tasks: "all" },
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
  return { permissions: { keys, scopes }, dropped: template.keys.length - keys.length };
}

export const TEMPLATE_KEYS_ARE_VALID = ROLE_TEMPLATES.every((t) => t.keys.every((k) => ALL_PERMISSION_KEYS.includes(k)));
