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
  "templates",
  "agents",
  "knowledge",
  "content",
  "scheduling",
  "calls",
  "forms",
  "sales",
  "tasks",
  "integrations",
  "team",
  "settings",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

/** Como se llama cada grupo en la pantalla de roles (los grupos del plano, §9.1). */
export const MODULE_LABELS: Record<PermissionModule, string> = {
  dashboards: "Dashboards",
  social: "Social",
  inbox: "Bandeja",
  contacts: "Contactos",
  flows: "Automatizaciones",
  templates: "Banca de recursos",
  agents: "Agente de IA",
  knowledge: "Base de conocimiento",
  content: "Contenido",
  scheduling: "Agenda",
  calls: "Llamadas",
  forms: "Formularios",
  sales: "Ventas",
  tasks: "Tareas",
  integrations: "Integraciones",
  team: "Equipo",
  settings: "Configuración",
};

export interface PermissionDefinition {
  key: string;
  module: PermissionModule;
  label: string;
  /** Que implica de verdad, en una linea. */
  description: string;
  /** Reservada para una fase futura: existe en el catalogo pero la pantalla no la muestra. */
  reserved?: boolean;
  /** Solo la tiene el Owner: ni el Admin ni un rol personalizado. */
  ownerOnly?: boolean;
}

/**
 * Todas las claves, con su etiqueta en castellano.
 *
 * La etiqueta importa tanto como la clave: la pantalla de roles la muestra
 * tal cual, y "inbox.whatsapp.reply" no le dice nada a nadie.
 *
 * Son 74 claves; 72 visibles (dos estan reservadas). Cada clave nueva se suma
 * aca, en la pantalla, en el guard, en la RLS y en `catalog-usage.test.ts` en el
 * MISMO cambio (ver `docs/roles.md`, "Como sumar una clave nueva").
 */
export const PERMISSION_KEYS: PermissionDefinition[] = [
  // ── Dashboards ──────────────────────────────────────────────────────────
  { key: "dashboards.chat.view", module: "dashboards", label: "Ver el dashboard de chat", description: "Cuánto se responde, qué tan rápido y quién." },
  { key: "dashboards.content.view", module: "dashboards", label: "Ver el dashboard de contenido", description: "Seguidores, alcance y engagement de lo que se publica." },
  { key: "dashboards.ads.view", module: "dashboards", label: "Ver el dashboard de anuncios", description: "Gasto, clics y leads de Meta Ads. Incluye los montos." },
  { key: "dashboards.agenda.view", module: "dashboards", label: "Ver el dashboard de agenda", description: "Reuniones agendadas, quién las pide y de dónde vienen. Se ven solo las que el alcance de agenda permite." },
  { key: "dashboards.unified.view", module: "dashboards", label: "Ver el dashboard unificado", description: "Lo orgánico y lo pago del mismo período, uno al lado del otro." },

  // ── Social ──────────────────────────────────────────────────────────────
  { key: "social.view", module: "social", label: "Ver la página Social", description: "El perfil de cada red y sus publicaciones." },

  // ── Bandeja, por canal ──────────────────────────────────────────────────
  { key: "inbox.instagram.view", module: "inbox", label: "Ver conversaciones de Instagram", description: "Las ve según el alcance de conversaciones." },
  { key: "inbox.instagram.reply", module: "inbox", label: "Responder por Instagram", description: "Escribir en esas conversaciones, mandar recursos y aprobar borradores del agente." },
  { key: "inbox.whatsapp.view", module: "inbox", label: "Ver conversaciones de WhatsApp", description: "Las ve según el alcance de conversaciones." },
  { key: "inbox.whatsapp.reply", module: "inbox", label: "Responder por WhatsApp", description: "Escribir en esas conversaciones, mandar recursos y aprobar borradores del agente." },
  { key: "inbox.email.view", module: "inbox", label: "Ver conversaciones de email", description: "Las ve según el alcance de conversaciones." },
  { key: "inbox.email.reply", module: "inbox", label: "Responder emails", description: "Escribir en esas conversaciones y aprobar borradores del agente." },

  // ── Contactos ───────────────────────────────────────────────────────────
  { key: "contacts.view", module: "contacts", label: "Ver contactos", description: "El alcance decide si ve todos o solo los suyos." },
  { key: "contacts.edit", module: "contacts", label: "Editar contactos", description: "Datos, etiquetas, campos y marca de no contactar." },
  { key: "contacts.import", module: "contacts", label: "Importar contactos", description: "Subir un CSV y ver el historial de importaciones." },
  { key: "contacts.delete", module: "contacts", label: "Borrar contactos", description: "Borrado suave, con 30 días de retención. También quita la marca de no contactar." },
  { key: "contacts.assign", module: "contacts", label: "Reasignar contactos", description: "Cambiar el setter, el vendedor o la persona a cargo de un contacto." },
  { key: "contacts.merge", module: "contacts", label: "Fusionar contactos", description: "Unir dos fichas en una. No se puede deshacer." },
  { key: "tags.manage", module: "contacts", label: "Administrar etiquetas", description: "Renombrar y borrar etiquetas, y definir las que apagan el agente o asignan." },
  { key: "custom_fields.manage", module: "contacts", label: "Administrar campos personalizados", description: "Crear, editar y borrar los campos de la ficha. Completar su valor es de «Editar contactos»." },
  { key: "assignment.manage", module: "contacts", label: "Administrar reglas de asignación", description: "Quién recibe cada lead nuevo." },

  // ── Automatizaciones ────────────────────────────────────────────────────
  { key: "flows.view", module: "flows", label: "Ver automatizaciones", description: "La lista y el contenido de cada flujo." },
  { key: "flows.edit", module: "flows", label: "Editar automatizaciones", description: "Crear, cambiar y borrar flujos y sus disparadores." },
  { key: "flows.publish", module: "flows", label: "Publicar automatizaciones", description: "Ponerlas a correr y volver a una versión anterior." },
  { key: "sequences.view", module: "flows", label: "Ver secuencias", description: "Las secuencias y quién está inscripto." },
  { key: "sequences.edit", module: "flows", label: "Editar secuencias", description: "Crear, cambiar y borrar secuencias, e inscribir contactos." },
  { key: "broadcasts.manage", module: "flows", label: "Enviar broadcasts", description: "Mensajes a muchos contactos a la vez." },
  { key: "webhooks.manage", module: "flows", label: "Administrar webhooks", description: "Crear y cambiar las direcciones que reciben datos de otros sistemas, y los flujos que arrancan con ellas." },

  // La clave conserva su nombre de cuando eran plantillas: un rol que ya la
  // tenia marcada sigue teniendo sentido, y renombrarla dejaria la vieja
  // colgada en los jsonb de los roles (banca v2, F4).
  { key: "templates.manage", module: "templates", label: "Administrar la banca de recursos", description: "Crear, editar y borrar textos, audios, videos, imágenes, archivos y enlaces. Verlos y usarlos puede cualquiera." },

  // ── Agente de IA ────────────────────────────────────────────────────────
  { key: "agents.view", module: "agents", label: "Ver el agente", description: "Su configuración y lo que hizo." },
  { key: "agents.edit", module: "agents", label: "Editar el agente", description: "Prender, apagar y cambiar cómo responde." },
  { key: "ai_costs.view", module: "agents", label: "Ver los costos de IA", description: "Cuánto se gasta en modelos." },
  { key: "ai_tasks.manage", module: "agents", label: "Administrar las tareas de IA", description: "Instrucciones, modelo y criterios de las tareas en segundo plano: clasificar, resumir, transcribir, describir imágenes e indexar." },
  { key: "ai_limits.manage", module: "agents", label: "Administrar topes y precios de IA", description: "Los topes de gasto, los avisos y los precios de cada modelo." },

  // ── Conocimiento ────────────────────────────────────────────────────────
  { key: "knowledge.view", module: "knowledge", label: "Ver la base de conocimiento", description: "Los documentos que lee el agente." },
  { key: "knowledge.edit", module: "knowledge", label: "Editar la base de conocimiento", description: "Subir y borrar documentos." },

  // ── Contenido ───────────────────────────────────────────────────────────
  { key: "content.view", module: "content", label: "Ver el tablero de contenido", description: "Las ideas y piezas del equipo." },
  { key: "content.create", module: "content", label: "Crear y editar piezas", description: "Las suyas, hasta mandarlas a revisión." },
  { key: "content.approve", module: "content", label: "Aprobar y devolver piezas", description: "Decidir si una pieza pasa a programarse." },
  { key: "content.publish", module: "content", label: "Programar y publicar", description: "Lo que sale a las redes de verdad." },
  { key: "content.ai", module: "content", label: "Generar copy con IA", description: "Gasta del presupuesto de IA del negocio." },

  // ── Agenda (Etapa 4, §5) ────────────────────────────────────────────────
  { key: "scheduling.use", module: "scheduling", label: "Tener agenda propia", description: "Perfil, sus cuentas de Google Calendar, horarios, excepciones, tiempo fuera y eventos." },
  { key: "scheduling.manage_others", module: "scheduling", label: "Configurar agendas ajenas", description: "Perfil (salvo cuentas de Google), horarios y eventos de otras personas." },
  { key: "scheduling.team_events", module: "scheduling", label: "Crear eventos de equipo", description: "Reservado para la fase de equipos. Sin uso todavía.", reserved: true },
  { key: "scheduling.manage_categories", module: "scheduling", label: "Administrar áreas y tipos de agenda", description: "Crear, renombrar, reordenar y archivar categorías." },
  { key: "bookings.view", module: "scheduling", label: "Ver agendas", description: "El alcance decide si ve todas o solo las que es anfitrión." },
  { key: "bookings.manage", module: "scheduling", label: "Gestionar agendas", description: "Cancelar, reagendar, marcar, editar y agendar a mano. Mismo alcance que ver." },

  // ── Llamadas (Fathom + analizador de llamadas) ──────────────────────────
  { key: "calls.view", module: "calls", label: "Ver las llamadas", description: "La lista, la ficha, el análisis y el dashboard de Llamadas, según el alcance." },
  { key: "calls.edit", module: "calls", label: "Editar las llamadas", description: "Cambiar el tipo, vincular contacto y agenda, analizar, corregir, regenerar, resumir, mandar a Conocimiento e importar." },
  { key: "calls.configure", module: "calls", label: "Configurar el análisis de llamadas", description: "Reglas, tipos, rúbrica, categorías y contexto del negocio de las tareas Clasificación y Análisis de llamadas." },

  // ── Formularios (personalizado, encuesta/NPS y contrato) ────────────────
  { key: "forms.view", module: "forms", label: "Ver formularios y respuestas", description: "La lista, el editor en solo lectura, las métricas y el panel de encuesta. De las respuestas, solo las de los contactos que puede ver." },
  { key: "forms.manage", module: "forms", label: "Crear y publicar formularios", description: "Crear, editar, duplicar, publicar, pausar y archivar; mapear a contacto; vincular respuestas a mano; marcar spam; reenviar la copia del contrato." },
  // Reportes de fin de dia (E10). Completar uno no necesita permiso: alcanza con estar en su
  // audiencia. Cada persona ve siempre los suyos. La RLS lo lee en `can_view_eod_all` (00180).
  { key: "eod.view_all", module: "forms", label: "Ver los reportes de fin de día de todo el equipo", description: "Los reportes ENVIADOS de todas las personas, sus totales y quién falta hoy. Los borradores ajenos no los ve nadie." },

  // ── Ventas y pagos (Etapa 5, Fase 1) ────────────────────────────────────
  { key: "sales.view", module: "sales", label: "Ver las ventas", description: "La lista, la ficha, los pagos y el historial de cada venta, según el alcance." },
  { key: "sales.manage", module: "sales", label: "Cargar y editar ventas", description: "Cargar, editar y cancelar ventas; enviar el contrato. Pasar el tope de descuento exige alcance «todos»." },
  { key: "payments.manage", module: "sales", label: "Gestionar los pagos", description: "Cobrar, revertir un cobro, agregar una cuota, reprogramar, marcar incobrable y reembolsar." },
  { key: "products.manage", module: "sales", label: "Administrar productos", description: "El catálogo: productos, variantes, precios y estados." },
  { key: "sales.settings", module: "sales", label: "Configurar ventas y cobranza", description: "Métodos de pago, tope de descuento, días de gracia y los flujos de cobranza." },

  // ── Tareas (Extra A) ────────────────────────────────────────────────────
  { key: "tasks.view", module: "tasks", label: "Ver las tareas", description: "La tabla y el tablero de Tareas. El alcance decide si ve todas o solo las que creó, tiene a cargo o sigue." },
  { key: "tasks.edit", module: "tasks", label: "Crear y editar tareas", description: "Crear tareas, editarlas, completarlas, reasignarlas y agregar seguidores. Mismo alcance que ver." },
  { key: "tasks.delete", module: "tasks", label: "Borrar tareas", description: "Borrar tareas. Se borran de forma lógica: dejan de verse pero quedan en el historial." },

  // ── Integraciones ───────────────────────────────────────────────────────
  { key: "integrations.view", module: "integrations", label: "Ver las integraciones", description: "El estado de cada integración, sin las claves ni botones de cambio." },
  { key: "integrations.manage", module: "integrations", label: "Administrar integraciones", description: "Conectar cuentas del negocio y guardar claves: IA, email, Meta Ads, publicación." },
  { key: "channels.manage", module: "integrations", label: "Administrar canales", description: "Conectar y desconectar Instagram, WhatsApp y email." },

  // ── Equipo ──────────────────────────────────────────────────────────────
  { key: "team.view", module: "team", label: "Ver el equipo", description: "Quiénes son, con qué rol y desde cuándo. Sin cambiar nada." },
  { key: "team.invite", module: "team", label: "Invitar personas", description: "Invitar por email o por link, reenviar, renovar y anular invitaciones. Solo con roles que uno mismo puede dar." },
  { key: "team.manage", module: "team", label: "Administrar el equipo", description: "Cambiarle el rol a una persona y marcar quién es closer." },
  { key: "team.remove", module: "team", label: "Quitar personas del equipo", description: "Solo el Owner. Saca a alguien del negocio.", ownerOnly: true },
  { key: "roles.view", module: "team", label: "Ver los roles", description: "La lista de roles y lo que puede cada uno, sin editar." },
  { key: "roles.manage", module: "team", label: "Administrar roles", description: "Crear roles y elegir qué puede cada uno. Solo puede dar permisos que uno mismo tiene." },

  // ── Configuración ───────────────────────────────────────────────────────
  { key: "settings.general", module: "settings", label: "Cambiar la configuración general", description: "Nombre del negocio, palabras clave, no contactar, zona horaria, retención de archivos y los ajustes del negocio." },
  { key: "audit.view", module: "settings", label: "Ver la actividad", description: "El historial de lo que cambió y quién lo cambió." },
  { key: "data.export", module: "settings", label: "Exportar datos", description: "Bajar a CSV las respuestas de formularios, los reportes de fin de día, las corridas de IA y la tabla de anuncios." },
  { key: "workspace.transfer", module: "settings", label: "Transferir la propiedad", description: "Solo el Owner. Es irreversible.", reserved: true, ownerOnly: true },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_KEYS.map((p) => p.key);

export function permissionsOfModule(module: PermissionModule): PermissionDefinition[] {
  return PERMISSION_KEYS.filter((p) => p.module === module);
}

export function permissionLabel(key: string): string {
  return PERMISSION_KEYS.find((p) => p.key === key)?.label ?? key;
}

/** Las claves que la pantalla de roles muestra (todas menos las reservadas). */
export const VISIBLE_PERMISSION_KEYS: PermissionDefinition[] = PERMISSION_KEYS.filter((p) => !p.reserved);

/** Las claves solo-Owner: ni el Admin ni un rol personalizado las tienen. */
export const OWNER_ONLY_KEYS: string[] = PERMISSION_KEYS.filter((p) => p.ownerOnly).map((p) => p.key);

/** Los permisos de un grupo tal como los muestra la pantalla: sin las reservadas. */
export function visiblePermissionsOfModule(module: PermissionModule): PermissionDefinition[] {
  return VISIBLE_PERMISSION_KEYS.filter((p) => p.module === module);
}

// ── Alcances ──────────────────────────────────────────────────────────────

/** Los modulos donde importa CUANTO se ve, no solo si se ve. */
export const SCOPED_MODULES = ["leads", "conversations", "bookings", "calls", "sales", "tasks"] as const;
export type ScopedModule = (typeof SCOPED_MODULES)[number];

/**
 * `own` = solo donde esta asignado. `all` = todo el workspace.
 * `own_unassigned` = lo suyo + lo que no tiene a nadie asignado: solo existe
 * para los leads (00136); en conversaciones y agendas no significa nada.
 */
export type PermissionScope = "own" | "own_unassigned" | "all";

export const SCOPE_LABELS: Record<PermissionScope, string> = {
  own: "Solo los suyos",
  own_unassigned: "Los suyos + los sin asignar",
  all: "Todos los del negocio",
};

/** Los alcances que se pueden elegir para cada modulo. */
export function scopeOptionsFor(module: ScopedModule): readonly PermissionScope[] {
  return module === "leads" ? (["own", "own_unassigned", "all"] as const) : (["own", "all"] as const);
}

/** Un valor guardado, validado para ese modulo: lo que no conoce es `own`, lo mas angosto. */
export function normalizeScope(module: ScopedModule, value: unknown): PermissionScope {
  return scopeOptionsFor(module).includes(value as PermissionScope) ? (value as PermissionScope) : "own";
}

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
 *  - Ve y edita contactos con el mismo alcance y reasigna los que ve. NO importa ni borra.
 *  - Ve y edita flows (y los publica) y ve secuencias; NO las edita.
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
  // Reasignar los leads que ve: hoy puede hacerlo (nunca hubo un chequeo de rol). Se conserva
  // (plano §9.3, decision del 13/10/2026).
  "contacts.assign",
  "flows.view",
  "flows.edit",
  // Publicar flujos: hoy puede (la API no chequea el rol). Se conserva (plano §9.3). Se quita
  // sacando esta linea.
  "flows.publish",
  "sequences.view",
  "agents.view",
  "content.view",
  "content.create",
  "scheduling.use",
  "bookings.view",
  "bookings.manage",
  // Llamadas (decision 152): un Member ve las llamadas que grabo y las de los
  // contactos que puede ver. NO edita ni configura.
  "calls.view",
  // Formularios (alcance v7.1 §4.5): ve las respuestas de los contactos que ve
  // (lo aplica la RLS). NO crea ni publica formularios.
  "forms.view",
  // Ventas (Etapa 5): un Member carga y cobra las ventas donde es setter o
  // vendedor (alcance `own`, aplicado por la RLS y por las acciones). NO
  // administra productos ni reglas de asignación (products.manage / assignment.manage).
  "sales.view",
  "sales.manage",
  "payments.manage",
  // Tareas (Extra A): un Member crea, edita y completa las tareas que creo, tiene a
  // cargo o sigue (alcance `own`, aplicado por la RLS). NO borra (`tasks.delete`).
  "tasks.view",
  "tasks.edit",
] as const;

/**
 * Copia de la lista del Member para la base (`private.member_permission_keys()`, 00208).
 * `lib/auth/member-sql-parity.test.ts` falla si las dos listas se separan.
 */
export const MEMBER_PERMISSION_KEYS: readonly string[] = MEMBER_KEYS;

export const SYSTEM_ROLE_PERMISSIONS: Record<"owner" | "admin" | "member", RolePermissions> = {
  owner: {
    keys: [...ALL_PERMISSION_KEYS],
    scopes: { leads: "all", conversations: "all", bookings: "all", calls: "all", sales: "all", tasks: "all" },
  },
  admin: {
    // Todo salvo lo solo-Owner (transferir la propiedad, quitar personas).
    keys: ALL_PERMISSION_KEYS.filter((key) => !OWNER_ONLY_KEYS.includes(key)),
    scopes: { leads: "all", conversations: "all", bookings: "all", calls: "all", sales: "all", tasks: "all" },
  },
  member: {
    keys: [...MEMBER_KEYS],
    scopes: { leads: "own", conversations: "own", bookings: "own", calls: "own", sales: "own", tasks: "own" },
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

  const scope = (module: ScopedModule): PermissionScope => normalizeScope(module, scopes[module]);

  return {
    keys: Array.isArray(record.keys)
      ? record.keys.filter((key): key is string => typeof key === "string" && ALL_PERMISSION_KEYS.includes(key))
      : [],
    scopes: { leads: scope("leads"), conversations: scope("conversations"), bookings: scope("bookings"), calls: scope("calls"), sales: scope("sales"), tasks: scope("tasks") },
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
