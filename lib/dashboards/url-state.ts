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

/** Un instante ISO valido, o null. */
function validInstant(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : raw;
}

/** Lee los filtros de los searchParams. Tolerante: valores inválidos caen al default. */
export function parseDashboardFilters(params: URLSearchParams): DashboardFilters {
  const channel = params.get("channel");
  const author = params.get("author");
  const range = params.get("range");
  // Un rango a medida solo cuenta si las dos puntas son fechas de verdad: con
  // una sola, o con basura, la pantalla volveria a un periodo que nadie eligio y
  // los numeros no se corresponderian con el boton.
  const from = validInstant(params.get("from"));
  const to = validInstant(params.get("to"));
  const custom = from !== null && to !== null;
  return {
    channel: channel && channel !== "all" ? channel : null,
    author: author && author !== "all" ? author : null,
    period: range && isPeriodPreset(range) ? range : DEFAULT_PERIOD,
    from: custom ? from : null,
    to: custom ? to : null,
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
