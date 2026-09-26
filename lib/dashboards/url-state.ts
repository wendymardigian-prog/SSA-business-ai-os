import { isPeriodPreset, type PeriodPreset } from "./period";

/**
 * Estado del dashboard en la URL (F14): canal, respondido por, período. Ida y
 * vuelta URL ↔ estado, para que compartir un link reconstruya la vista.
 */
export interface DashboardFilters {
  channel: string | null;
  author: string | null;
  period: PeriodPreset;
  /** Rango a medida (period = 'custom-range' implícito por from/to). */
  from: string | null;
  to: string | null;
}

export const DEFAULT_PERIOD: PeriodPreset = "30d";

/** Lee los filtros de los searchParams. Tolerante: valores inválidos caen al default. */
export function parseDashboardFilters(params: URLSearchParams): DashboardFilters {
  const channel = params.get("channel");
  const author = params.get("author");
  const range = params.get("range");
  const from = params.get("from");
  const to = params.get("to");
  return {
    channel: channel && channel !== "all" ? channel : null,
    author: author && author !== "all" ? author : null,
    period: range && isPeriodPreset(range) ? range : DEFAULT_PERIOD,
    from: from || null,
    to: to || null,
  };
}

/** Serializa los filtros a query params (sólo lo que difiere del default). */
export function dashboardFiltersToParams(filters: DashboardFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.channel) p.set("channel", filters.channel);
  if (filters.author) p.set("author", filters.author);
  if (filters.from && filters.to) {
    p.set("from", filters.from);
    p.set("to", filters.to);
  } else if (filters.period !== DEFAULT_PERIOD) {
    p.set("range", filters.period);
  }
  return p;
}

/** Chips de los filtros activos (para la franja de contexto). */
export function activeFilterChips(filters: DashboardFilters, labels: { channel?: (id: string) => string; author?: (id: string) => string }): Array<{ key: string; label: string }> {
  const chips: Array<{ key: string; label: string }> = [];
  if (filters.channel) chips.push({ key: "channel", label: labels.channel?.(filters.channel) ?? filters.channel });
  if (filters.author) chips.push({ key: "author", label: labels.author?.(filters.author) ?? filters.author });
  return chips;
}
