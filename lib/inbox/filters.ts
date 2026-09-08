/**
 * Filtros de la bandeja (F16).
 *
 * Todo lo que se puede decidir sin ir a la base vive aca: que valores son
 * validos, cuantos filtros hay activos, y si una conversacion que llego por
 * realtime todavia entra en lo que se esta mirando.
 *
 * Ese ultimo punto es el que justifica el archivo. Hasta ahora la lista
 * agregaba cualquier conversacion nueva del workspace sin mirar el filtro de
 * estado, y nunca sacaba una que dejara de cumplirlo. Con filtros de verdad
 * eso se vuelve visible: aparecerian conversaciones que el filtro excluye.
 */

import type { ConversationStatus } from "@/lib/types/database";
import type { DatePreset } from "@/lib/dates";

/** "all" no es un estado de la base: es "no filtres por estado". */
export const INBOX_STATUS_VALUES = ["all", "open", "closed", "snoozed"] as const;
export type InboxStatus = (typeof INBOX_STATUS_VALUES)[number];

/**
 * La bandeja arranca en "abiertas" porque es la pregunta de todos los dias
 * ("que me falta contestar"). Era el default de antes y se conserva.
 */
export const DEFAULT_INBOX_STATUS: InboxStatus = "open";

export const INBOX_STATUS_LABELS: Record<InboxStatus, string> = {
  all: "Todas",
  open: "Abiertas",
  closed: "Cerradas",
  snoozed: "Pospuestas",
};

/**
 * Valores especiales del filtro de asignacion. Los demas son ids de miembros
 * del equipo.
 */
export const ASSIGNMENT_ANY = "";
export const ASSIGNMENT_UNASSIGNED = "sin-asignar";
export const ASSIGNMENT_AI = "agente-ia";

export interface InboxFilters {
  search: string;
  status: InboxStatus;
  /** Plataformas de los canales activos, ej ["instagram", "whatsapp"]. */
  platforms: string[];
  /** Ids de tags; el contacto tiene que tener al menos uno. */
  tagIds: string[];
  /** "", "sin-asignar", "agente-ia" o el id de un miembro. */
  assignment: string;
  datePreset: DatePreset | "";
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_INBOX_FILTERS: InboxFilters = {
  search: "",
  status: DEFAULT_INBOX_STATUS,
  platforms: [],
  tagIds: [],
  assignment: ASSIGNMENT_ANY,
  datePreset: "",
  dateFrom: "",
  dateTo: "",
};

/**
 * Cuantos filtros hay puestos, para el contador del boton.
 *
 * El estado cuenta solo cuando NO es el default: la bandeja siempre arranca
 * mostrando las abiertas, y decir "1 filtro activo" apenas se entra seria
 * ruido. Las categorias multi-valor cuentan como una: quien eligio tres tags
 * puso un filtro de tags, no tres filtros.
 */
export function countActiveFilters(filters: InboxFilters): number {
  let count = 0;
  if (filters.search) count++;
  if (filters.status !== DEFAULT_INBOX_STATUS) count++;
  if (filters.platforms.length > 0) count++;
  if (filters.tagIds.length > 0) count++;
  if (filters.assignment) count++;
  if (filters.datePreset) count++;
  return count;
}

/**
 * Si hay algun filtro que solo se puede resolver con datos que la fila de
 * conversations no trae: los tags y el setter/vendedor viven en el contacto, y
 * "agente IA" depende de los mensajes.
 *
 * Cuando esto es true, una fila que llega por realtime no se puede evaluar en
 * el cliente y hay que volver a preguntarle al servidor.
 */
export function needsServerToFilter(filters: InboxFilters): boolean {
  return filters.tagIds.length > 0 || filters.assignment !== ASSIGNMENT_ANY;
}

export interface FilterableRow {
  status: string;
  platform: string;
  last_message_at: string | null;
  created_at: string;
  last_message_preview: string | null;
  contacts: { display_name: string | null } | null;
}

/**
 * Si una fila entra en lo que se esta mirando, con lo que se puede saber sin
 * consultar la base. Solo tiene sentido llamarla cuando needsServerToFilter
 * dio false.
 *
 * `range` es el rango de fechas ya resuelto por el servidor: la conversion de
 * "hoy" a un instante depende de la zona horaria y esa cuenta se hace en un
 * solo lugar (lib/dates.ts).
 */
export function matchesInboxRow(
  row: FilterableRow,
  filters: InboxFilters,
  range: { from: string | null; to: string | null },
): boolean {
  if (filters.status !== "all" && row.status !== filters.status) return false;

  if (filters.platforms.length > 0 && !filters.platforms.includes(row.platform)) return false;

  const when = row.last_message_at ?? row.created_at;
  if (range.from && when < range.from) return false;
  if (range.to && when > range.to) return false;

  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const name = (row.contacts?.display_name ?? "").toLowerCase();
    const preview = (row.last_message_preview ?? "").toLowerCase();
    if (!name.includes(needle) && !preview.includes(needle)) return false;
  }

  return true;
}

/** Traduce el estado del filtro al valor que espera la columna. */
export function statusForQuery(status: InboxStatus): ConversationStatus | null {
  return status === "all" ? null : (status as ConversationStatus);
}
