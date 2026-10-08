/**
 * El catalogo de permisos (F68).
 *
 * Hasta acá un permiso era `role === "admin"`: o podías todo o casi nada.
 * Eso alcanza con tres personas, y deja de alcanzar cuando hay alguien que
 * tiene que ver los dashboards pero no tocar las integraciones, o alguien
 * que edita contenido pero no lo publica.
 *
 * Dos decisiones que sostienen el archivo:
 *
 * 1. **Los permisos de Member son EXACTAMENTE los de hoy.** Están escritos
 *    abajo derivados de la caracterización (`member-baseline.test.ts`), no
 *    de lo que parecería razonable. Un rol de sistema que cambia de
 *    comportamiento al refactorizar es un permiso que alguien pierde o gana
 *    sin que nadie lo decida.
 * 2. **Owner y Admin se diferencian en una sola cosa**: transferir la
 *    propiedad del workspace. Todo lo demás lo puede un Admin.
 *
 * Modulo puro: no sabe de Supabase. Los guards lo consultan; la base tiene
 * su propia copia de la parte que le toca (`has_permission`).
 */

export const PERMISSION_MODULES = [
  "dashboards",
  "social",
  "inbox",
  "contacts",
  "flows",
  "sequences",
  "broadcasts",
  "templates",
  "agents",
  "knowledge",
  "content",
  "scheduling",
  "integrations",
  "team",
  "settings",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export interface PermissionDefinition {
  key: string;
  module: PermissionModule;
  label: string;
  /** Que implica de verdad, en una linea. */
  description: string;
}

/**
 * Todas las claves, con su etiqueta en castellano.
 *
 * La etiqueta importa tanto como la clave: la pantalla de roles la muestra
 * tal cual, y "inbox.whatsapp.reply" no le dice nada a nadie.
 */
export const PERMISSION_KEYS: PermissionDefinition[] = [
  // ── Dashboards ──────────────────────────────────────────────────────────
  { key: "dashboards.chat.view", module: "dashboards", label: "Ver el dashboard de chat", description: "Cuanto se responde, que tan rapido y quien." },
  { key: "dashboards.content.view", module: "dashboards", label: "Ver el dashboard de contenido", description: "Seguidores, alcance y engagement de lo que se publica." },
  { key: "dashboards.ads.view", module: "dashboards", label: "Ver el dashboard de anuncios", description: "Gasto, clics y leads de Meta Ads. Incluye los montos." },

  // ── Social ──────────────────────────────────────────────────────────────
  { key: "social.view", module: "social", label: "Ver la pagina Social", description: "El perfil de cada red y sus publicaciones." },

  // ── Bandeja, por canal ──────────────────────────────────────────────────
  { key: "inbox.instagram.view", module: "inbox", label: "Ver conversaciones de Instagram", description: "" },
  { key: "inbox.instagram.reply", module: "inbox", label: "Responder por Instagram", description: "" },
  { key: "inbox.whatsapp.view", module: "inbox", label: "Ver conversaciones de WhatsApp", description: "" },
  { key: "inbox.whatsapp.reply", module: "inbox", label: "Responder por WhatsApp", description: "" },
  { key: "inbox.email.view", module: "inbox", label: "Ver conversaciones de email", description: "" },
  { key: "inbox.email.reply", module: "inbox", label: "Responder emails", description: "" },

  // ── Contactos ───────────────────────────────────────────────────────────
  { key: "contacts.view", module: "contacts", label: "Ver contactos", description: "El alcance decide si ve todos o solo los suyos." },
  { key: "contacts.edit", module: "contacts", label: "Editar contactos", description: "Datos, etiquetas, campos y asignaciones." },
  { key: "contacts.import", module: "contacts", label: "Importar contactos", description: "Subir un CSV." },
  { key: "contacts.delete", module: "contacts", label: "Borrar contactos", description: "Borrado suave, con 30 dias de retencion." },

  // ── Automatizaciones ────────────────────────────────────────────────────
  { key: "flows.view", module: "flows", label: "Ver automatizaciones", description: "" },
  { key: "flows.edit", module: "flows", label: "Editar automatizaciones", description: "Incluye publicarlas, que es lo que las pone a correr." },
  { key: "sequences.view", module: "sequences", label: "Ver secuencias", description: "" },
  { key: "sequences.edit", module: "sequences", label: "Editar secuencias", description: "" },
  { key: "broadcasts.manage", module: "broadcasts", label: "Enviar broadcasts", description: "Mensajes a muchos contactos a la vez." },
  // La clave conserva su nombre de cuando eran plantillas: un rol que ya la
  // tenia marcada sigue teniendo sentido, y renombrarla dejaria la vieja
  // colgada en los jsonb de los roles (banca v2, F4).
  { key: "templates.manage", module: "templates", label: "Administrar la banca de recursos", description: "Crear, editar y borrar textos, audios, videos, imágenes, archivos y enlaces. Verlos y usarlos puede cualquiera." },

  // ── Agente de IA ────────────────────────────────────────────────────────
  { key: "agents.view", module: "agents", label: "Ver el agente", description: "Su configuracion y lo que hizo." },
  { key: "agents.edit", module: "agents", label: "Editar el agente", description: "Prender, apagar y cambiar como responde." },
  { key: "ai_costs.view", module: "agents", label: "Ver los costos de IA", description: "Cuanto se gasta en modelos." },
  { key: "knowledge.view", module: "knowledge", label: "Ver la base de conocimiento", description: "" },
  { key: "knowledge.edit", module: "knowledge", label: "Editar la base de conocimiento", description: "Subir y borrar documentos." },

  // ── Contenido ───────────────────────────────────────────────────────────
  { key: "content.view", module: "content", label: "Ver el tablero de contenido", description: "" },
  { key: "content.create", module: "content", label: "Crear y editar piezas", description: "Las suyas, hasta mandarlas a revision." },
  { key: "content.approve", module: "content", label: "Aprobar y devolver piezas", description: "" },
  { key: "content.publish", module: "content", label: "Programar y publicar", description: "Lo que sale a las redes de verdad." },
  { key: "content.ai", module: "content", label: "Generar copy con IA", description: "Gasta del presupuesto de IA del negocio." },

  // ── Agenda (Etapa 4, §5) ────────────────────────────────────────────────
  { key: "scheduling.use", module: "scheduling", label: "Tener agenda propia", description: "Perfil, sus cuentas de Google Calendar, horarios, excepciones, tiempo fuera y eventos." },
  { key: "scheduling.manage_others", module: "scheduling", label: "Configurar agendas ajenas", description: "Perfil (salvo cuentas de Google), horarios y eventos de otras personas." },
  { key: "scheduling.team_events", module: "scheduling", label: "Crear eventos de equipo", description: "Reservado para la fase de equipos. Sin uso todavia." },
  { key: "scheduling.manage_categories", module: "scheduling", label: "Administrar areas y tipos de agenda", description: "Crear, renombrar, reordenar y archivar categorias." },
  { key: "bookings.view", module: "scheduling", label: "Ver agendas", description: "El alcance decide si ve todas o solo las que es anfitrion." },
  { key: "bookings.manage", module: "scheduling", label: "Gestionar agendas", description: "Cancelar, reagendar, marcar, editar y agendar a mano. Mismo alcance que ver." },

  // ── Configuracion ───────────────────────────────────────────────────────
  { key: "integrations.manage", module: "integrations", label: "Administrar integraciones", description: "Conectar cuentas y guardar claves." },
  { key: "team.manage", module: "team", label: "Administrar el equipo", description: "Invitar personas y cambiarles el rol." },
  { key: "roles.manage", module: "team", label: "Administrar roles", description: "Crear roles y elegir que puede cada uno." },
  { key: "settings.manage", module: "settings", label: "Cambiar la configuracion", description: "Zona horaria, canales, tareas en segundo plano." },
  { key: "workspace.transfer", module: "settings", label: "Transferir la propiedad", description: "Solo el Owner. Es irreversible." },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_KEYS.map((p) => p.key);

export function permissionsOfModule(module: PermissionModule): PermissionDefinition[] {
  return PERMISSION_KEYS.filter((p) => p.module === module);
}

export function permissionLabel(key: string): string {
  return PERMISSION_KEYS.find((p) => p.key === key)?.label ?? key;
}

// ── Alcances ──────────────────────────────────────────────────────────────

/** Los modulos donde importa CUANTO se ve, no solo si se ve. */
export const SCOPED_MODULES = ["leads", "conversations", "bookings"] as const;
export type ScopedModule = (typeof SCOPED_MODULES)[number];

/** `own` = solo donde esta asignado. `all` = todo el workspace. */
export type PermissionScope = "own" | "all";

export const SCOPE_LABELS: Record<PermissionScope, string> = {
  own: "Solo los suyos",
  all: "Todos los del negocio",
};

// ── Los tres roles de sistema ─────────────────────────────────────────────

export interface RolePermissions {
  keys: string[];
  scopes: Record<ScopedModule, PermissionScope>;
}

/**
 * Lo que puede un Member HOY.
 *
 * Sale de la caracterizacion (`member-baseline.test.ts`), no de lo que
 * pareceria razonable:
 *
 *  - Ve la bandeja de todos los canales y responde, pero solo en las
 *    conversaciones donde esta asignado (alcance `own`, aplicado por la RLS).
 *  - Ve y edita contactos con el mismo alcance. NO importa ni borra.
 *  - Ve y edita flows y secuencias.
 *  - Ve el dashboard de chat. NO ve el de contenido ni el de anuncios.
 *  - Ve el agente. NO lo edita ni ve los costos.
 *  - En contenido: crea y edita sus piezas y las manda a revision. NO
 *    aprueba, NO programa, NO usa la IA.
 *  - NO ve Social, ni Canales, ni Conocimiento, ni nada de Ajustes.
 *  - Agenda (Etapa 4, §5 del plano): tiene agenda propia y ve y gestiona
 *    las agendas donde es anfitrion (alcance `own`). NO configura agendas
 *    ajenas ni las categorias.
 */
const MEMBER_KEYS = [
  "dashboards.chat.view",
  "inbox.instagram.view",
  "inbox.instagram.reply",
  "inbox.whatsapp.view",
  "inbox.whatsapp.reply",
  "inbox.email.view",
  "inbox.email.reply",
  "contacts.view",
  "contacts.edit",
  "flows.view",
  "flows.edit",
  "sequences.view",
  "sequences.edit",
  "agents.view",
  "content.view",
  "content.create",
  "scheduling.use",
  "bookings.view",
  "bookings.manage",
] as const;

export const SYSTEM_ROLE_PERMISSIONS: Record<"owner" | "admin" | "member", RolePermissions> = {
  owner: {
    keys: [...ALL_PERMISSION_KEYS],
    scopes: { leads: "all", conversations: "all", bookings: "all" },
  },
  admin: {
    // Todo salvo transferir la propiedad: eso es irreversible y es del Owner.
    keys: ALL_PERMISSION_KEYS.filter((key) => key !== "workspace.transfer"),
    scopes: { leads: "all", conversations: "all", bookings: "all" },
  },
  member: {
    keys: [...MEMBER_KEYS],
    scopes: { leads: "own", conversations: "own", bookings: "own" },
  },
};

// ── Las tres preguntas ────────────────────────────────────────────────────

/**
 * Si ese rol tiene ese permiso.
 *
 * Una clave que no existe devuelve false. Es a proposito: un permiso mal
 * escrito no puede abrir una puerta, y ademas hace que renombrar una clave
 * cierre el acceso en vez de abrirlo.
 */
export function can(permissions: RolePermissions | null | undefined, key: string): boolean {
  if (!permissions) return false;
  if (!ALL_PERMISSION_KEYS.includes(key)) return false;
  return permissions.keys.includes(key);
}

/** Si tiene al menos uno de esos permisos. */
export function canAny(
  permissions: RolePermissions | null | undefined,
  keys: string[],
): boolean {
  return keys.some((key) => can(permissions, key));
}

/** Si tiene todos. */
export function canAll(
  permissions: RolePermissions | null | undefined,
  keys: string[],
): boolean {
  return keys.length > 0 && keys.every((key) => can(permissions, key));
}

/** El alcance de ese modulo. Sin permisos, el mas restrictivo. */
export function scopeFor(
  permissions: RolePermissions | null | undefined,
  module: ScopedModule,
): PermissionScope {
  return permissions?.scopes[module] ?? "own";
}

// ── Guardar y leer un rol ─────────────────────────────────────────────────

/**
 * Los permisos guardados, validados.
 *
 * Las claves que no existen se descartan en vez de romper: una clave vieja
 * en un rol guardado no puede dejar a alguien sin poder entrar. `can` las
 * rechazaria igual; sacarlas al leer mantiene la fila limpia.
 */
export function parsePermissions(value: unknown): RolePermissions {
  const record = (value ?? {}) as { keys?: unknown; scopes?: unknown };
  const scopes = (record.scopes ?? {}) as Record<string, unknown>;

  const scope = (module: ScopedModule): PermissionScope =>
    scopes[module] === "all" ? "all" : "own";

  return {
    keys: Array.isArray(record.keys)
      ? record.keys.filter((key): key is string => typeof key === "string" && ALL_PERMISSION_KEYS.includes(key))
      : [],
    scopes: { leads: scope("leads"), conversations: scope("conversations"), bookings: scope("bookings") },
  };
}

/** Un rol sin ningun permiso no sirve para nada: la pantalla lo advierte. */
export function isEmptyRole(permissions: RolePermissions): boolean {
  return permissions.keys.length === 0;
}

/** Los permisos de un rol de sistema, por su nombre. */
export function systemRolePermissions(role: string): RolePermissions | null {
  if (role === "owner" || role === "admin" || role === "member") {
    return SYSTEM_ROLE_PERMISSIONS[role];
  }
  return null;
}
