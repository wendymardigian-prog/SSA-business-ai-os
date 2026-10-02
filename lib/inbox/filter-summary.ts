/**
 * La barra de filtros de la Bandeja, puesta en palabras (Bloque I, I3).
 *
 * Modulo puro. Consume `countActiveFilters` de `lib/inbox/filters.ts` y no lo
 * reescribe: la semantica de que cuenta como filtro sigue viviendo ahi.
 */

import { DATE_PRESET_LABELS } from "@/lib/dates";
import {
  ASSIGNMENT_AI,
  ASSIGNMENT_ANY,
  ASSIGNMENT_UNASSIGNED,
  DEFAULT_INBOX_STATUS,
  INBOX_STATUS_LABELS,
  countActiveFilters,
  type InboxFilters,
} from "@/lib/inbox/filters";

export interface FilterSummaryCatalog {
  platforms: { value: string; label: string }[];
  tags: { id: string; name: string }[];
  members: { userId: string; label: string }[];
}

/**
 * Cuantos filtros hay puestos ADENTRO del popover.
 *
 * `countActiveFilters` cuenta tambien la busqueda y el estado, que desde el
 * Bloque I viven afuera (la busqueda en la barra, el estado en las pastillas
 * arriba de la lista). Si el boton los contara, diria "4" con tres cosas
 * marcadas adentro. Se neutralizan esos dos y se cuenta el resto con la misma
 * funcion de siempre.
 */
export function countMenuFilters(filters: InboxFilters): number {
  return countActiveFilters({ ...filters, search: "", status: DEFAULT_INBOX_STATUS });
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/** "2026-09-01" -> "1/9". Sin Date: la fecha de la URL ya es de pared. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  if (!month || !day) return iso;
  return `${Number(day)}/${Number(month)}`;
}

function dateLabel(filters: InboxFilters): string | null {
  if (!filters.datePreset) return null;
  if (filters.datePreset !== "custom") return DATE_PRESET_LABELS[filters.datePreset];
  const { dateFrom, dateTo } = filters;
  if (dateFrom && dateTo) return `Del ${shortDate(dateFrom)} al ${shortDate(dateTo)}`;
  if (dateFrom) return `Desde el ${shortDate(dateFrom)}`;
  if (dateTo) return `Hasta el ${shortDate(dateTo)}`;
  return DATE_PRESET_LABELS.custom;
}

function assignmentLabel(assignment: string, members: FilterSummaryCatalog["members"]): string | null {
  if (assignment === ASSIGNMENT_ANY) return null;
  if (assignment === ASSIGNMENT_UNASSIGNED) return "Sin asignar";
  if (assignment === ASSIGNMENT_AI) return "Asignadas al agente IA";
  const member = members.find((m) => m.userId === assignment);
  return member ? `Asignadas a ${member.label}` : "Asignadas a alguien del equipo";
}

/**
 * Las partes del resumen, en el orden en que se leen: estado, busqueda,
 * canales, tags, asignacion, fecha y las dos marcas del agente.
 *
 * Con uno o dos canales se nombran; con mas, se cuentan. Un tag se nombra; mas
 * de uno, se cuenta. La linea tiene que entrar en una pantalla de telefono.
 */
export function describeInboxFilters(filters: InboxFilters, catalog: FilterSummaryCatalog): string[] {
  const parts: string[] = [INBOX_STATUS_LABELS[filters.status]];

  if (filters.search) parts.push(`"${filters.search}"`);

  if (filters.platforms.length > 0) {
    if (filters.platforms.length <= 2) {
      for (const value of filters.platforms) {
        parts.push(catalog.platforms.find((p) => p.value === value)?.label ?? value);
      }
    } else {
      parts.push(plural(filters.platforms.length, "canal", "canales"));
    }
  }

  if (filters.tagIds.length === 1) {
    const tag = catalog.tags.find((t) => t.id === filters.tagIds[0]);
    parts.push(tag ? `#${tag.name}` : "1 tag");
  } else if (filters.tagIds.length > 1) {
    parts.push(plural(filters.tagIds.length, "tag", "tags"));
  }

  const assignment = assignmentLabel(filters.assignment, catalog.members);
  if (assignment) parts.push(assignment);

  const date = dateLabel(filters);
  if (date) parts.push(date);

  if (filters.agentError) parts.push("Con error del agente");
  if (filters.needsHuman) parts.push("Necesita humano");

  return parts;
}
