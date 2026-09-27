/**
 * Los calendarios de cada cuenta de Google (F5), la parte que se decide sin
 * base ni red: que se guarda de lo que Google devuelve, cuales se apagan y
 * que defaults se ponen la primera vez.
 */

import type { CalendarAccessRole } from "@/lib/types/database";

/** Lo que devuelve calendarList.list, ya normalizado por el cliente. */
export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  backgroundColor: string | null;
  accessRole: CalendarAccessRole;
  primary: boolean;
  deleted: boolean;
}

/** Lo que hay guardado de esa conexion. */
export interface CalendarRow {
  id: string;
  external_calendar_id: string;
  name: string;
  color: string | null;
  access_role: CalendarAccessRole;
  is_primary: boolean;
  check_conflicts: boolean;
  is_active: boolean;
}

/** Los de sistema (feriados, contactos, semanas) no sirven para nada aca. */
const SYSTEM_SUFFIXES = [
  "#holiday@group.v.calendar.google.com",
  "#contacts@group.v.calendar.google.com",
  "#weeknum@group.v.calendar.google.com",
];

export function isSystemCalendar(externalId: string): boolean {
  return SYSTEM_SUFFIXES.some((suffix) => externalId.endsWith(suffix));
}

export const WRITABLE_ROLES: CalendarAccessRole[] = ["owner", "writer"];

export function isWritable(role: CalendarAccessRole): boolean {
  return WRITABLE_ROLES.includes(role);
}

export interface CalendarUpsert {
  external_calendar_id: string;
  name: string;
  color: string | null;
  access_role: CalendarAccessRole;
  is_primary: boolean;
  is_active: true;
  /** Solo en las filas nuevas: el default de la primera vez. */
  check_conflicts?: boolean;
}

export interface CalendarSyncPlan {
  /** Filas nuevas, con su default de conflictos. */
  inserts: CalendarUpsert[];
  /** Filas que ya estaban: se refrescan nombre, color, rol y primario; el switch no se toca. */
  updates: Array<{ id: string; patch: Omit<CalendarUpsert, "check_conflicts"> }>;
  /** Ids de filas que ya no vienen: quedan inactivas. */
  deactivate: string[];
}

/**
 * Que hacer con lo que devolvio Google.
 *
 * - Los de sistema y los borrados no se guardan.
 * - Un calendario nuevo nace con `check_conflicts = true` solo si es el
 *   primario de la cuenta (F5: "por defecto queda encendido el principal").
 * - Uno que ya estaba conserva su switch: sincronizar no le cambia la
 *   decision a la persona.
 * - Uno que ya no viene queda inactivo (no se borra: puede tener eventos
 *   apuntandole).
 */
export function planCalendarSync(existing: CalendarRow[], fromGoogle: GoogleCalendarListItem[]): CalendarSyncPlan {
  const byExternal = new Map(existing.map((row) => [row.external_calendar_id, row]));
  const seen = new Set<string>();
  const plan: CalendarSyncPlan = { inserts: [], updates: [], deactivate: [] };

  for (const item of fromGoogle) {
    if (item.deleted || isSystemCalendar(item.id)) continue;
    seen.add(item.id);
    const base = {
      external_calendar_id: item.id,
      name: item.summary,
      color: item.backgroundColor,
      access_role: item.accessRole,
      is_primary: item.primary,
      is_active: true as const,
    };
    const current = byExternal.get(item.id);
    if (current) {
      plan.updates.push({ id: current.id, patch: base });
    } else {
      plan.inserts.push({ ...base, check_conflicts: item.primary });
    }
  }

  for (const row of existing) {
    if (row.is_active && !seen.has(row.external_calendar_id)) plan.deactivate.push(row.id);
  }

  return plan;
}

/**
 * El calendario destino por defecto que conviene poner si el perfil no
 * tiene: el primario de la primera cuenta, siempre que se pueda escribir.
 */
export function suggestDefaultDestination(
  calendars: Array<Pick<CalendarRow, "id" | "is_primary" | "access_role" | "is_active">>,
): string | null {
  const candidates = calendars.filter((c) => c.is_active && isWritable(c.access_role));
  return candidates.find((c) => c.is_primary)?.id ?? candidates[0]?.id ?? null;
}

/** Los que se pueden elegir como destino (owner o writer, activos). */
export function destinationOptions<T extends Pick<CalendarRow, "access_role" | "is_active">>(calendars: T[]): T[] {
  return calendars.filter((c) => c.is_active && isWritable(c.access_role));
}
