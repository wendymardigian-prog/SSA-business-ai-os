/**
 * La fusion de contactos (R9). PURO: ni el navegador ni el servidor dependen de nada de aca.
 *
 * `merge_contacts` (00207) mueve TODO lo que cuelga del duplicado al contacto principal en una transaccion. Esta lista dice
 * que tablas cubre; `scripts/verify-contact-merge.mjs` falla si aparece en la base una relacion con `contacts` que no este
 * aca ni en `CONTACT_MERGE_EXCLUSIONS` (con su motivo), asi una tabla futura no queda fuera de la fusion sin que alguien lo note.
 */

/** Las tablas con una relacion a `contacts` que la fusion mueve (25: `contacts` es `referred_by_contact_id`). */
export const CONTACT_MERGE_TABLES = [
  "agent_drafts",
  "agent_runs",
  "analytics_events",
  "automation_events",
  "bookings",
  "broadcast_recipients",
  "calls", // @plantilla-quitar(llamadas)
  "contact_channels",
  "contact_custom_fields",
  "contact_notes",
  "contact_status_changes", // el historial de estados del pipeline (00245, la fusion desde la 00247)
  "contact_tags",
  "contact_touches",
  "contacts", // referred_by_contact_id: los contactos que el duplicado habia referido
  "contract_signatures", // @plantilla-quitar(formularios)
  "conversations", // y los mensajes de las que se unifican
  "email_log",
  "flow_sessions",
  "form_submissions", // @plantilla-quitar(formularios)
  "inbound_webhooks", // @plantilla-quitar(webhooks)
  "sales", // los pagos y demas cuelgan de la venta y la siguen // @plantilla-quitar(ventas)
  "sequence_enrollments",
  "social_post_comments",
  "tasks", // @plantilla-quitar(tareas)
  "trigger_fires",
] as const;

/** Relaciones con `contacts` que a proposito NO se mueven, y por que. Hoy ninguna. */
export const CONTACT_MERGE_EXCLUSIONS: Readonly<Record<string, string>> = {};

export interface MergeMoved {
  [key: string]: number;
}

interface Label {
  keys: readonly string[];
  one: string;
  many: string;
}

/** Que se nombra en el aviso, en este orden. Cada entrada suma las claves que el resultado trae. */
const LABELS: readonly Label[] = [
  { keys: ["conversations", "conversations_merged"], one: "conversación", many: "conversaciones" },
  { keys: ["messages_moved"], one: "mensaje", many: "mensajes" },
  { keys: ["bookings"], one: "agenda", many: "agendas" },
  { keys: ["calls"], one: "llamada", many: "llamadas" }, // @plantilla-quitar(llamadas)
  { keys: ["sales"], one: "venta", many: "ventas" }, // @plantilla-quitar(ventas)
  { keys: ["tasks"], one: "tarea", many: "tareas" }, // @plantilla-quitar(tareas)
  { keys: ["form_submissions"], one: "respuesta de formulario", many: "respuestas de formularios" }, // @plantilla-quitar(formularios)
  { keys: ["contract_signatures"], one: "firma de contrato", many: "firmas de contratos" }, // @plantilla-quitar(formularios)
  { keys: ["contact_channels"], one: "canal", many: "canales" },
  { keys: ["contact_notes"], one: "nota", many: "notas" },
  { keys: ["contact_tags"], one: "etiqueta", many: "etiquetas" },
  { keys: ["contact_custom_fields"], one: "campo personalizado", many: "campos personalizados" },
  { keys: ["contact_touches"], one: "toque de atribución", many: "toques de atribución" },
  { keys: ["sequence_enrollments"], one: "inscripción a secuencias", many: "inscripciones a secuencias" },
  { keys: ["flow_sessions"], one: "sesión de automatización", many: "sesiones de automatización" },
  { keys: ["email_log"], one: "email", many: "emails" },
  { keys: ["social_post_comments"], one: "comentario", many: "comentarios" },
  { keys: ["inbound_webhooks"], one: "aviso de webhook", many: "avisos de webhooks" }, // @plantilla-quitar(webhooks)
  { keys: ["referred_contacts"], one: "contacto referido", many: "contactos referidos" },
  { keys: ["automation_events"], one: "evento de automatización", many: "eventos de automatización" },
  { keys: ["agent_runs"], one: "corrida del agente", many: "corridas del agente" },
  { keys: ["agent_drafts"], one: "borrador del agente", many: "borradores del agente" },
  { keys: ["analytics_events"], one: "evento de analítica", many: "eventos de analítica" },
  { keys: ["broadcast_recipients"], one: "envío masivo", many: "envíos masivos" },
  { keys: ["trigger_fires"], one: "disparo de automatización", many: "disparos de automatización" },
];

const num = (moved: MergeMoved, key: string): number => {
  const v = Number(moved[key]);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
};

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** «Se unificaron 2 conversaciones, 1 agenda y 3 tareas.» Solo lo que no es cero, en un orden estable. */
export function summarizeMerge(result: { moved?: MergeMoved } | MergeMoved | null | undefined): string {
  const moved = ((result as { moved?: MergeMoved } | null | undefined)?.moved ?? result ?? {}) as MergeMoved;
  const parts: string[] = [];
  for (const label of LABELS) {
    const n = label.keys.reduce((sum, key) => sum + num(moved, key), 0);
    if (n > 0) parts.push(`${n} ${n === 1 ? label.one : label.many}`);
  }
  return parts.length === 0 ? "Se unificaron los contactos (no había nada más para mover)." : `Se unificaron ${joinList(parts)}.`;
}

/** Lo que paso con lo que no se podia mover tal cual (para quien quiera el detalle). */
export function mergeNotes(result: { moved?: MergeMoved } | MergeMoved | null | undefined): string[] {
  const moved = ((result as { moved?: MergeMoved } | null | undefined)?.moved ?? result ?? {}) as MergeMoved;
  const notes: string[] = [];
  const add = (key: string, one: string, many: string) => {
    const n = num(moved, key);
    if (n > 0) notes.push(n === 1 ? one : many.replace("{n}", String(n)));
  };
  add("sequence_enrollments_cancelled", "Se canceló 1 inscripción repetida a una secuencia.", "Se cancelaron {n} inscripciones repetidas a secuencias.");
  add("flow_sessions_cancelled", "Se canceló 1 sesión de automatización repetida.", "Se cancelaron {n} sesiones de automatización repetidas.");
  add("automation_events_cancelled", "Se canceló 1 evento de automatización pendiente.", "Se cancelaron {n} eventos de automatización pendientes.");
  add("tasks_detached", "1 tarea de seguimiento quedó como tarea normal (ya había otra para esa fecha).", "{n} tareas de seguimiento quedaron como tareas normales (ya había otra para esa fecha).");
  add("messages_left", "1 mensaje repetido quedó en la conversación vieja.", "{n} mensajes repetidos quedaron en la conversación vieja.");
  return notes;
}

// ── El resultado en la URL (despues de fusionar se va a la ficha del principal) ──────────────────────────────────────

const NOTE_KEYS = ["sequence_enrollments_cancelled", "flow_sessions_cancelled", "automation_events_cancelled", "tasks_detached", "messages_left"] as const;
const PARAM_KEYS = new Set<string>([...LABELS.flatMap((l) => l.keys), ...NOTE_KEYS]);

/** `conversations.2,tasks.3`: solo claves conocidas y numeros, nada de texto libre. */
export function encodeMergeParam(moved: MergeMoved | undefined): string {
  return Object.entries(moved ?? {})
    .filter(([key]) => PARAM_KEYS.has(key))
    .map(([key, value]) => [key, num({ [key]: value }, key)] as const)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${key}.${n}`)
    .join(",");
}

export function decodeMergeParam(value: string | string[] | undefined | null): MergeMoved {
  const raw = Array.isArray(value) ? value[0] : value;
  const moved: MergeMoved = {};
  for (const piece of (raw ?? "").split(",")) {
    const [key, n] = piece.split(".");
    const count = Number(n);
    if (PARAM_KEYS.has(key) && Number.isInteger(count) && count > 0 && count < 1_000_000) moved[key] = count;
  }
  return moved;
}

// ── Errores de la funcion de base ───────────────────────────────────────────────────────────────────────────────────

export function mergeErrorMessage(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("merge_same_contact")) return "Es el mismo contacto";
  if (m.includes("merge_not_found") || m.includes("merge_deleted")) return "No encontre alguno de los dos contactos";
  if (m.includes("merge_workspace_mismatch")) return "Los dos contactos tienen que ser del mismo negocio";
  return "No pude unir los contactos. No se movió nada: probá de nuevo.";
}

// ── La guardia de deriva ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Dado el conjunto de tablas que hoy tienen una relacion con `contacts` en la base (una clave foranea, o una columna
 * `contact_id` / `referred_by_contact_id` aunque no tenga clave), dice cuales NO estan cubiertas por la fusion ni
 * excluidas con motivo (`missing`: hay que sumarlas a `merge_contacts` y a `CONTACT_MERGE_TABLES`) y cuales de la lista ya
 * no existen en la base (`stale`).
 */
export function findMergeDrift(relations: Iterable<string>): { missing: string[]; stale: string[] } {
  const inDb = new Set(relations);
  const covered = new Set<string>([...CONTACT_MERGE_TABLES, ...Object.keys(CONTACT_MERGE_EXCLUSIONS)]);
  return {
    missing: [...inDb].filter((t) => !covered.has(t)).sort(),
    stale: [...covered].filter((t) => !inDb.has(t)).sort(),
  };
}
