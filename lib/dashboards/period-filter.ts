import { parsePeriodFilter, periodFilterToParams, type PeriodFilter } from "@/lib/agent/ai-dashboard/url-state";
import { formatRange, isoRangeToCivil } from "./chat/date-range";
import { DEFAULT_PERIOD } from "./url-state";
import { PERIOD_LABELS, resolvePeriod, type PeriodPreset, type ResolvedPeriod } from "./period";

/**
 * El periodo de un dashboard en la URL: un atajo (`range`) o un rango a medida (`from` y `to`), con el mismo
 * vocabulario que Chat y Agenda. Puro: lo usan las paginas, los links y el navegador.
 *
 * `periodo` es el nombre viejo del atajo. Se sigue leyendo para que no se rompa un link guardado, pero ya no se escribe.
 */

export type { PeriodFilter };

/** Lo que devuelve el selector de fechas al aplicar. */
export interface PeriodSelection {
  preset: PeriodPreset | null;
  from: string | null;
  to: string | null;
}

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function single(params: RawParams, key: string): string | null {
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  return typeof value === "string" ? value : null;
}

/** Lee el periodo. Tolerante: lo invalido cae a los 30 dias de siempre, y un rango invertido no cuenta como rango. */
export function readDashboardPeriod(params: RawParams): PeriodFilter {
  const normalized = new URLSearchParams();
  for (const [key, value] of [
    ["range", single(params, "range") ?? single(params, "periodo")],
    ["from", single(params, "from")],
    ["to", single(params, "to")],
  ] as const) {
    if (value) normalized.set(key, value);
  }

  const filter = parsePeriodFilter(normalized);
  if (filter.from && filter.to && new Date(filter.from).getTime() > new Date(filter.to).getTime()) {
    return { ...filter, from: null, to: null };
  }
  return filter;
}

/** Los instantes del periodo: el rango a medida gana sobre el atajo. */
export function resolveDashboardPeriod(filter: PeriodFilter, now: Date, timeZone: string): ResolvedPeriod {
  return filter.from && filter.to ? { from: filter.from, to: filter.to } : resolvePeriod(filter.period, now, timeZone);
}

/** Los parametros de un link que conserva el periodo (sin el «?»). */
export function periodQuery(filter: PeriodFilter, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(extra);
  for (const [key, value] of periodFilterToParams(filter)) params.set(key, value);
  return params.toString();
}

/**
 * Pone lo elegido en la URL sin tocar el resto de los filtros. Borra lo anterior: sin esto, elegir un atajo despues
 * de un rango no haria nada, porque el rango gana.
 */
export function applyPeriodToParams(current: URLSearchParams, selection: PeriodSelection): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const key of ["range", "periodo", "from", "to"]) params.delete(key);
  const filter: PeriodFilter = { period: selection.preset ?? DEFAULT_PERIOD, from: selection.from, to: selection.to };
  for (const [key, value] of periodFilterToParams(filter)) params.set(key, value);
  return params;
}

/** Como se llama el periodo en un texto: «Últimos 30 días» o «2 sept 2026 – 5 sept 2026». */
export function periodLabel(filter: PeriodFilter, timeZone: string): string {
  const civil = isoRangeToCivil(filter.from, filter.to, timeZone);
  return civil ? formatRange(civil) : PERIOD_LABELS[filter.period];
}
