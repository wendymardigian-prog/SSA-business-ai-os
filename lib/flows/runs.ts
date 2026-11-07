/**
 * El historial de ejecuciones de una automatizacion: las reglas de la pantalla (00292).
 *
 * Puro y sin consultas: que estado mostrar, como se lee cada motivo y que filtros valen. Los componentes solo lo componen.
 */

import { DATE_PRESETS, type DatePreset } from "@/lib/dates";
import { firstParam, pickEnum, pickPage, sanitizeSearch, type SearchParams } from "@/lib/url-params";

export const RUNS_PAGE_SIZE = 25;

export const RUN_STATES = ["en_curso", "esperando", "termino", "con_fallos", "fallo", "cancelada"] as const;
export type RunState = (typeof RUN_STATES)[number];

export const RUN_STATE_LABELS: Record<RunState, string> = {
  en_curso: "En curso",
  esperando: "Esperando",
  termino: "Terminó",
  con_fallos: "Terminó con fallos",
  fallo: "Falló",
  cancelada: "Cancelada",
};

export const RUN_STATE_CLASSES: Record<RunState, string> = {
  en_curso: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
  esperando: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
  termino: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  con_fallos: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  fallo: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  cancelada: "bg-muted text-muted-foreground",
};

export interface RunStateInput {
  status: string;
  waiting_for_input: boolean;
  waiting_until: string | null;
  error_message: string | null;
  has_failed_step: boolean;
}

/** El estado que se muestra. El filtro de la lista (`runs-query.ts`) aplica estas mismas condiciones sobre las columnas. */
export function deriveRunState(run: RunStateInput): RunState {
  if (run.status === "active") return run.waiting_for_input || run.waiting_until ? "esperando" : "en_curso";
  if (run.status === "completed") return run.has_failed_step ? "con_fallos" : "termino";
  if (run.status === "cancelled" && (run.error_message || run.has_failed_step)) return "fallo";
  return "cancelada";
}

const SOURCE_LABELS: Record<string, string> = {
  contact: "Contacto",
  member: "Persona del equipo",
  webhook: "Webhook", // @plantilla-quitar(webhooks)
  task: "Tarea", // @plantilla-quitar(tareas)
  form: "Formulario", // @plantilla-quitar(formularios)
  booking: "Reunión",
  sale: "Venta", // @plantilla-quitar(ventas)
  call: "Llamada", // @plantilla-quitar(llamadas)
  system: "Sistema",
};

export function runSourceLabel(source: string | null | undefined): string {
  return (source && SOURCE_LABELS[source]) || "—";
}

const END_REASON_LABELS: Record<string, string> = {
  step_failed: "Un paso falló y la ejecución se cortó.",
  flow_deleted: "La automatización ya no existe.",
  flow_unpublished: "La automatización se despublicó mientras esta ejecución esperaba.",
  node_removed: "El paso en el que estaba esperando se sacó de la automatización.",
  depth_limit: "Se cortó porque pasó de 50 pasos seguidos.",
  wait_expired: "Se venció la espera de respuesta.",
  ai_failed: "No se pudo generar la respuesta con IA.",
  job_failed: "No se pudo retomar después de una espera.",
  reprocessed: "Se canceló porque el webhook se volvió a procesar.", // @plantilla-quitar(webhooks)
};

export function runEndReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return END_REASON_LABELS[reason] ?? null;
}

export type RunStepStatus = "ok" | "failed" | "skipped" | "waiting" | "deferred";

/** Como se lee un paso. Una espera que no es el ultimo paso ya termino: se cuenta en pasado. */
export function runStepStatusLabel(status: RunStepStatus, isLast: boolean): string {
  switch (status) {
    case "ok":
      return "Salió bien";
    case "failed":
      return "Falló";
    case "skipped":
      return "Se salteó";
    case "waiting":
      return isLast ? "En espera" : "Esperó";
    case "deferred":
      return isLast ? "Quedó para más tarde" : "Quedó para más tarde y se retomó";
  }
}

const REASON_CODES: Record<string, string> = {
  do_not_contact: "El contacto está marcado «no contactar».",
  unsubscribed: "La persona se dio de baja de los emails.",
  bounced: "El email de la persona rebota.",
  complained: "La persona marcó los emails como spam.",
  send_failed: "El proveedor de email rechazó el envío.",
  not_configured: "El proveedor de email no está configurado.",
};

/** Algunos motivos llegan como un codigo: se traducen. Lo demas ya viene en español y saneado. */
export function runStepReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return REASON_CODES[reason] ?? reason;
}

/** La duracion para leer de un vistazo. Sin hora de fin (o una hora rara) es «—», nunca un cero. */
export function formatRunDuration(startIso: string | null | undefined, endIso: string | null | undefined): string {
  if (!startIso || !endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return "Menos de 1 s";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

/** Con la zona de quien mira: da lo mismo en el servidor y en el navegador. */
export function formatRunDate(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
}

export interface FlowRunFilters {
  estado: RunState | "";
  fecha: DatePreset | "";
  desde: string;
  hasta: string;
  q: string;
  page: number;
  /** La ejecucion abierta en el panel. */
  ejecucion: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Lo que viene de la URL se valida: un valor inventado se ignora en vez de romper la consulta. */
export function parseFlowRunFilters(params: SearchParams): FlowRunFilters {
  const ejecucion = firstParam(params.ejecucion);
  const desde = firstParam(params.desde);
  const hasta = firstParam(params.hasta);
  return {
    estado: pickEnum(params.estado, RUN_STATES, ""),
    fecha: pickEnum(params.fecha, DATE_PRESETS, ""),
    desde: CIVIL_DATE.test(desde) ? desde : "",
    hasta: CIVIL_DATE.test(hasta) ? hasta : "",
    q: sanitizeSearch(firstParam(params.q)),
    page: pickPage(params.page),
    ejecucion: UUID.test(ejecucion) ? ejecucion : null,
  };
}

export function countActiveFlowRunFilters(filters: FlowRunFilters): number {
  return [filters.estado, filters.fecha, filters.q].filter(Boolean).length;
}
