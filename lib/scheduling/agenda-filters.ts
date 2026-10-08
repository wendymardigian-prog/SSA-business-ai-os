/**
 * El widget de filtros de Agenda (F33, revisión de Agenda v2).
 *
 * El parseo con validación de ids contra lo que existe en el workspace (la
 * barrera que impide que la URL meta un id ajeno en un `.in()`) vive en la
 * page, con `pickIds`/`listParam` de `lib/url-params.ts`: ahí están las
 * listas reales de categorías, eventos y anfitriones. Acá vive lo que no
 * necesita la base: las etiquetas, cuántos filtros hay puestos y los chips de
 * la línea "Filtrando: …", que se quitan de a uno (a diferencia de la Bandeja,
 * donde una sola `×` limpia todo).
 */

import { categoryLabel, type CategoryRow } from "./categories";
import { BOOKING_STATUS_KEYS, STATUS_GROUPS, STATUS_GROUP_LABELS, groupOf, statusLabel } from "./booking-status";
import type { BookingOrigin, BookingStatus } from "./types";

/**
 * De dónde salió una agenda. Antes vivía duplicado (y ligeramente distinto:
 * "Agente" acá, "Agente de IA" allá) en `page.tsx` y en
 * `components/scheduling/bookings/list.tsx`. Esta es la única copia.
 */
export const ORIGIN_VALUES: readonly BookingOrigin[] = ["public_page", "embed", "manual", "agent", "api"];

export const ORIGIN_LABELS: Record<BookingOrigin, string> = {
  public_page: "Link público",
  embed: "Embed",
  manual: "A mano",
  agent: "Agente de IA",
  api: "API",
};

export function isBookingOrigin(value: string): value is BookingOrigin {
  return (ORIGIN_VALUES as readonly string[]).includes(value);
}

/** Los 11 estados, agrupados en el orden del catálogo (para el grupo "Estado" del widget). */
export function statusGroupsForFilter(): Array<{ group: string; label: string; statuses: BookingStatus[] }> {
  return STATUS_GROUPS.map((group) => ({
    group,
    label: STATUS_GROUP_LABELS[group],
    statuses: BOOKING_STATUS_KEYS.filter((s) => groupOf(s) === group),
  }));
}

export interface AgendaFilters {
  /** Estado fino (los 11 reales), independiente de la pastilla rápida Próximas/Sin resultado/... */
  statuses: string[];
  /** Ids de área y tipo, sin expandir todavía (la expansión a tipos es cosa de la page). */
  categoryIds: string[];
  eventTypeIds: string[];
  hostUserIds: string[];
  origins: string[];
  utmSources: string[];
  utmMediums: string[];
  utmCampaigns: string[];
}

export const EMPTY_AGENDA_FILTERS: AgendaFilters = {
  statuses: [],
  categoryIds: [],
  eventTypeIds: [],
  hostUserIds: [],
  origins: [],
  utmSources: [],
  utmMediums: [],
  utmCampaigns: [],
};

/** Cuántos GRUPOS de filtro hay puestos, para el contador del botón. Tres estados elegidos cuentan uno. */
export function countActiveAgendaFilters(filters: AgendaFilters): number {
  let count = 0;
  if (filters.statuses.length) count++;
  if (filters.categoryIds.length) count++;
  if (filters.eventTypeIds.length) count++;
  if (filters.hostUserIds.length) count++;
  if (filters.origins.length) count++;
  if (filters.utmSources.length || filters.utmMediums.length || filters.utmCampaigns.length) count++;
  return count;
}

export type AgendaFilterParam = "estado" | "categoria" | "evento" | "anfitrion" | "origen" | "utm_source" | "utm_medium" | "utm_campaign";

export interface AgendaFilterChip {
  param: AgendaFilterParam;
  value: string;
  label: string;
}

export interface AgendaFilterCatalog {
  categories: CategoryRow[];
  events: Map<string, string>;
  hosts: Map<string, string>;
}

/**
 * Un chip por valor elegido, para que cada uno se saque con su propia `×`
 * (`toggle(param, value)` en el cliente deshace exactamente ese chip).
 */
export function agendaFilterChips(filters: AgendaFilters, catalog: AgendaFilterCatalog): AgendaFilterChip[] {
  const chips: AgendaFilterChip[] = [];

  for (const s of filters.statuses) {
    if ((BOOKING_STATUS_KEYS as string[]).includes(s)) chips.push({ param: "estado", value: s, label: statusLabel(s as BookingStatus) });
  }
  for (const id of filters.categoryIds) {
    const label = categoryLabel(id, catalog.categories);
    if (label) chips.push({ param: "categoria", value: id, label });
  }
  for (const id of filters.eventTypeIds) {
    chips.push({ param: "evento", value: id, label: catalog.events.get(id) ?? "Evento" });
  }
  for (const id of filters.hostUserIds) {
    chips.push({ param: "anfitrion", value: id, label: catalog.hosts.get(id) ?? "Alguien del equipo" });
  }
  for (const o of filters.origins) {
    if (isBookingOrigin(o)) chips.push({ param: "origen", value: o, label: ORIGIN_LABELS[o] });
  }
  for (const v of filters.utmSources) chips.push({ param: "utm_source", value: v, label: `Fuente: ${v}` });
  for (const v of filters.utmMediums) chips.push({ param: "utm_medium", value: v, label: `Medio: ${v}` });
  for (const v of filters.utmCampaigns) chips.push({ param: "utm_campaign", value: v, label: `Campaña: ${v}` });

  return chips;
}
