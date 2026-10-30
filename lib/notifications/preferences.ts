/**
 * Que avisos le llegan a cada persona y por donde (Mi cuenta → Notificaciones, 00274).
 *
 * PURO y sin dependencias de servidor: lo usan la pantalla, la campana
 * (`lib/actions/notifications.ts`) y el job que manda por email y WhatsApp
 * (`lib/jobs/handlers/notification-deliver.ts`). Una sola lista para los tres.
 *
 * Un EVENTO junta tipos de aviso parecidos ("reunion agendada, movida o
 * cancelada" es una fila, no tres). Cada tipo de `NOTIFICATION_TYPES` esta en
 * UN evento: `preferences.test.ts` falla si aparece un tipo nuevo sin evento.
 *
 * Lo que la persona cambio se guarda en `user_preferences.notification_prefs`
 * ({ evento: { bell, email, whatsapp } }); lo que no cambio usa `defaults`.
 * Cambiar un default aca cambia lo que reciben todos los que no lo tocaron.
 */

import type { NotificationType } from "./types";

export const NOTIFICATION_CHANNELS = ["bell", "email", "whatsapp"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type ChannelPrefs = Record<NotificationChannel, boolean>;

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  bell: "Campana",
  email: "Email",
  whatsapp: "WhatsApp",
};

export const NOTIFICATION_SECTIONS = [
  { key: "chat", title: "Chat" },
  { key: "tareas", title: "Tareas" },
  { key: "agenda", title: "Agenda" },
  { key: "contenido", title: "Contenido" },
  { key: "ventas", title: "Ventas y finanzas" },
  { key: "formularios", title: "Formularios y reportes" },
  { key: "ia", title: "Agente IA y gasto" },
  { key: "integraciones", title: "Canales e integraciones" },
  { key: "automatizaciones", title: "Automatizaciones y llamadas" },
] as const;
export type NotificationSectionKey = (typeof NOTIFICATION_SECTIONS)[number]["key"];

/**
 * A quien le puede llegar, para no mostrarle a nadie una fila que nunca va a recibir:
 * - `all`: puede llegarle a cualquiera (va a una persona concreta: el responsable, el anfitrion…).
 * - `admins`: solo a Owner y Admin, o a quien tenga alguno de los permisos de `permissions`.
 */
export type NotificationAudience = { kind: "all" } | { kind: "admins"; permissions?: readonly string[] };

export interface NotificationEvent {
  key: string;
  section: NotificationSectionKey;
  label: string;
  description: string;
  types: readonly NotificationType[];
  audience: NotificationAudience;
  defaults: ChannelPrefs;
}

const ALL: NotificationAudience = { kind: "all" };
const ADMINS: NotificationAudience = { kind: "admins" };
/** Solo campana: lo de siempre. */
const BELL: ChannelPrefs = { bell: true, email: false, whatsapp: false };
/** Lo critico: campana y email. */
const BELL_EMAIL: ChannelPrefs = { bell: true, email: true, whatsapp: false };

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  // ── Chat ──────────────────────────────────────────────────────────────
  {
    key: "chat_needs_person",
    section: "chat",
    label: "Un chat necesita una persona",
    description: "El agente derivó una conversación, no entendió un mensaje o no pudo responder: hay un lead esperando.",
    types: ["needs_human", "human_takeover", "agent_error"],
    audience: ALL,
    defaults: BELL_EMAIL,
  },
  {
    key: "chat_assigned",
    section: "chat",
    label: "Te asignaron un chat",
    description: "Alguien (o una regla) te dejó como responsable de una conversación.",
    types: ["conversation_assigned"],
    audience: ALL,
    defaults: BELL,
  },
  {
    key: "whatsapp_call_missed",
    section: "chat",
    label: "Llamada perdida de WhatsApp",
    description: "Alguien llamó por WhatsApp a un chat tuyo y nadie atendió.",
    types: ["whatsapp_call_missed"],
    audience: ALL,
    defaults: BELL,
  },
  {
    key: "drafts_expiring",
    section: "chat",
    label: "Borradores por vencer",
    description: "Respuestas del agente esperando aprobación a las que se les cierra la ventana para mandarlas.",
    types: ["draft_window"],
    audience: ALL,
    defaults: BELL,
  },
  // @plantilla-desde(tareas)
  // ── Tareas ────────────────────────────────────────────────────────────
  {
    key: "task_assigned",
    section: "tareas",
    label: "Te asignaron una tarea",
    description: "Una tarea nueva a tu cargo, o te sumaron como seguidor de una.",
    types: ["task_assigned", "task_follow_added"],
    audience: ALL,
    defaults: BELL,
  },
  {
    key: "task_updates",
    section: "tareas",
    label: "Cambios en tus tareas",
    description: "Cambió el estado, la fecha o el responsable de una tarea tuya, o quedó libre para empezar.",
    types: ["task_changed", "task_unblocked", "task_date_moved"],
    audience: ALL,
    defaults: BELL,
  },
  {
    key: "task_due",
    section: "tareas",
    label: "Tareas que vencen hoy o vencidas",
    description: "A la mañana, las tareas tuyas que vencen ese día o ya se pasaron.",
    types: ["task_due_today", "task_overdue"],
    audience: ALL,
    defaults: BELL,
  },
  // @plantilla-hasta(tareas)
  // ── Agenda ────────────────────────────────────────────────────────────
  {
    key: "bookings",
    section: "agenda",
    label: "Reuniones agendadas, movidas o canceladas",
    description: "Cuando alguien agenda, reagenda o cancela una reunión con vos.",
    types: ["booking_created", "booking_rescheduled", "booking_cancelled"],
    audience: ALL,
    defaults: BELL,
  },
  {
    key: "booking_sync",
    section: "agenda",
    label: "Una reunión no se pasó a Google Calendar",
    description: "La reunión quedó en el sistema pero no en tu calendario.",
    types: ["booking_sync_failed"],
    audience: ALL,
    defaults: BELL,
  },
  // ── Contenido ─────────────────────────────────────────────────────────
  {
    key: "content_review",
    section: "contenido",
    label: "Piezas para revisar",
    description: "Alguien pidió revisión de una pieza.",
    types: ["content_review_requested"],
    audience: ADMINS,
    defaults: BELL,
  },
  {
    key: "content_returned",
    section: "contenido",
    label: "Te devolvieron una pieza",
    description: "Una pieza tuya volvió a producción con un comentario.",
    types: ["content_returned"],
    audience: ALL,
    defaults: BELL,
  },
  {
    key: "content_problems",
    section: "contenido",
    label: "Una publicación no salió",
    description: "Falló una publicación, o se desprogramaron redes al desconectar una cuenta.",
    types: ["content_publish_failed", "content_networks_unscheduled"],
    audience: ADMINS,
    defaults: BELL_EMAIL,
  },
  {
    key: "content_copy",
    section: "contenido",
    label: "El copywriter terminó",
    description: "El texto que se pidió al copywriter ya está (o no lo pudo escribir).",
    types: ["content_copy_ready", "content_copy_failed"],
    audience: ADMINS,
    defaults: BELL,
  },
  // ── Ventas y finanzas ─────────────────────────────────────────────────
  // @plantilla-desde(comisiones)
  {
    key: "commissions_mine",
    section: "ventas",
    label: "Tus comisiones",
    description: "Generaste comisiones por una venta, o se pagaron las tuyas.",
    types: ["commission_generated", "commission_payout_paid"],
    audience: ALL,
    defaults: BELL,
  },
  {
    key: "commission_review",
    section: "ventas",
    label: "Un cobro revertido tenía comisiones pagadas",
    description: "Hay que revisar si corresponde un ajuste.",
    types: ["commission_review_needed"],
    audience: ADMINS,
    defaults: BELL,
  },
  // @plantilla-hasta(comisiones)
  // @plantilla-desde(finanzas)
  {
    key: "finance_alerts",
    section: "ventas",
    label: "Gastos vencidos o por revisar",
    description: "Gastos que vencieron, a los que les falta el monto, o automáticos que cambiaron después de pagados.",
    types: ["expense_overdue", "expense_review_pending", "expense_auto_changed"],
    audience: ADMINS,
    defaults: BELL,
  },
  // @plantilla-hasta(finanzas)
  // @plantilla-desde(formularios)
  // ── Formularios y reportes ────────────────────────────────────────────
  {
    key: "form_submitted",
    section: "formularios",
    label: "Respuestas nuevas en formularios",
    description: "Alguien respondió un formulario que te avisa.",
    types: ["form_submitted"],
    audience: ALL,
    defaults: BELL,
  },
  {
    key: "eod_submitted",
    section: "formularios",
    label: "Reportes de fin de día enviados",
    description: "Alguien del equipo envió su reporte del día.",
    types: ["eod_submitted"],
    audience: ALL,
    defaults: BELL,
  },
  {
    key: "eod_reminder",
    section: "formularios",
    label: "Recordatorio de tu reporte del día",
    description: "A la hora configurada, si todavía no enviaste el tuyo.",
    types: ["eod_reminder"],
    audience: ALL,
    defaults: BELL,
  },
  // @plantilla-hasta(formularios)
  // ── Agente IA y gasto ─────────────────────────────────────────────────
  {
    key: "ai_spend",
    section: "ia",
    label: "Topes y avisos de gasto de IA",
    description: "Se llegó (o se está por llegar) a un tope de gasto de IA.",
    types: [
      "agent_spend_limit",
      "ai_spend_threshold",
      "call_analysis_budget", // @plantilla-quitar(llamadas)
    ],
    audience: { kind: "admins", permissions: ["calls.configure"] },
    defaults: BELL,
  },
  {
    key: "agent_problems",
    section: "ia",
    label: "El agente tuvo un problema",
    description: "Un guardarrail frenó un mensaje, o falla el refresco contra Zernio.",
    types: ["agent_output_blocked", "refresh_health"],
    audience: ADMINS,
    defaults: BELL,
  },
  // ── Canales e integraciones ───────────────────────────────────────────
  {
    key: "channel_status",
    section: "integraciones",
    label: "Un canal se desconectó o cambió",
    description: "Un canal se cayó, volvió, tiene un problema, o se conectó una cuenta que algunos roles no ven.",
    types: ["channel_disconnected", "channel_reconnected", "channel_error", "channel_access_needed"],
    audience: ADMINS,
    defaults: BELL_EMAIL,
  },
  {
    key: "integration_attention",
    section: "integraciones",
    label: "Una integración necesita atención",
    description: "Una conexión vence o se revocó (también tu Google Calendar o tu Fathom), se agotó la cuota de emails o falla un webhook.",
    types: [
      "integration_attention",
      "email_quota_reached",
      "fathom_connection_error", // @plantilla-quitar(llamadas)
      "webhook_errors", // @plantilla-quitar(webhooks)
    ],
    audience: ALL,
    defaults: BELL_EMAIL,
  },
  // ── Automatizaciones y llamadas ───────────────────────────────────────
  {
    key: "flow_notice",
    section: "automatizaciones",
    label: "Avisos de automatizaciones",
    description: "Una automatización te mandó un aviso (paso «Avisar en la campana»).",
    types: ["flow_notice"],
    audience: ALL,
    defaults: BELL,
  },
  {
    key: "sequence_collision",
    section: "automatizaciones",
    label: "Secuencias en conflicto",
    description: "Un contacto quedó en dos secuencias a la vez por el mismo canal.",
    types: ["sequence_collision"],
    audience: ADMINS,
    defaults: BELL,
  },
  // @plantilla-desde(llamadas)
  {
    key: "call_objection",
    section: "automatizaciones",
    label: "Objeciones a un análisis de llamada",
    description: "Un closer no está de acuerdo con una parte del análisis de su llamada.",
    types: ["call_objection"],
    audience: { kind: "admins", permissions: ["calls.edit"] },
    defaults: BELL,
  },
  // @plantilla-hasta(llamadas)
];

const EVENT_BY_KEY = new Map(NOTIFICATION_EVENTS.map((e) => [e.key, e]));
const EVENT_BY_TYPE = new Map<string, NotificationEvent>();
for (const event of NOTIFICATION_EVENTS) for (const type of event.types) EVENT_BY_TYPE.set(type, event);

export function eventByKey(key: string): NotificationEvent | null {
  return EVENT_BY_KEY.get(key) ?? null;
}

/** El evento de un tipo de aviso, o null para un tipo que esta version no conoce. */
export function eventForType(type: string): NotificationEvent | null {
  return EVENT_BY_TYPE.get(type) ?? null;
}

/** Lo que la persona cambio, ya limpio: solo eventos que existen y valores booleanos. */
export type StoredPrefs = Record<string, Partial<ChannelPrefs>>;

export function parseStoredPrefs(raw: unknown): StoredPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: StoredPrefs = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!EVENT_BY_KEY.has(key) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const clean: Partial<ChannelPrefs> = {};
    for (const channel of NOTIFICATION_CHANNELS) {
      const v = (value as Record<string, unknown>)[channel];
      if (typeof v === "boolean") clean[channel] = v;
    }
    if (Object.keys(clean).length > 0) out[key] = clean;
  }
  return out;
}

/** Por donde le llega un evento a la persona: lo que eligio, si no el default. */
export function resolveEventPrefs(stored: StoredPrefs, event: NotificationEvent): ChannelPrefs {
  const own = stored[event.key] ?? {};
  return {
    bell: own.bell ?? event.defaults.bell,
    email: own.email ?? event.defaults.email,
    whatsapp: own.whatsapp ?? event.defaults.whatsapp,
  };
}

/**
 * Por donde le llega un TIPO de aviso. Un tipo que esta version no conoce va
 * solo a la campana: nunca se manda un email por algo que nadie eligio.
 */
export function resolveTypePrefs(stored: StoredPrefs, type: string): ChannelPrefs {
  const event = eventForType(type);
  return event ? resolveEventPrefs(stored, event) : BELL;
}

/** Cambia UN canal de UN evento. Si queda igual al default, no se guarda (asi un cambio futuro del default le llega). */
export function withPref(stored: StoredPrefs, eventKey: string, channel: NotificationChannel, value: boolean): StoredPrefs {
  const event = eventByKey(eventKey);
  if (!event) return stored;
  const next: StoredPrefs = { ...stored };
  const own: Partial<ChannelPrefs> = { ...(next[eventKey] ?? {}) };
  if (value === event.defaults[channel]) delete own[channel];
  else own[channel] = value;
  if (Object.keys(own).length === 0) delete next[eventKey];
  else next[eventKey] = own;
  return next;
}

/** Los tipos que la persona silencio en la campana: la campana no se los muestra. */
export function mutedBellTypes(stored: StoredPrefs): string[] {
  const out: string[] = [];
  for (const event of NOTIFICATION_EVENTS) {
    if (!resolveEventPrefs(stored, event).bell) out.push(...event.types);
  }
  return out;
}

/** Si un evento le puede llegar a esta persona (para mostrarle la fila). */
export function eventVisibleTo(event: NotificationEvent, viewer: { isAdmin: boolean; can: (key: string) => boolean }): boolean {
  if (event.audience.kind === "all" || viewer.isAdmin) return true;
  return (event.audience.permissions ?? []).some((key) => viewer.can(key));
}

/** Las secciones con sus eventos, solo las que tienen alguno para esta persona. */
export function sectionsFor(viewer: { isAdmin: boolean; can: (key: string) => boolean }) {
  return NOTIFICATION_SECTIONS.map((section) => ({
    ...section,
    events: NOTIFICATION_EVENTS.filter((e) => e.section === section.key && eventVisibleTo(e, viewer)),
  })).filter((section) => section.events.length > 0);
}
