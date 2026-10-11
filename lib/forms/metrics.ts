/**
 * Métricas por día de un formulario (F14): lógica pura de la pantalla.
 *
 * Los conteos salen de `form_metrics_daily` (vistas, inicios y rechazados de
 * `analytics_events`; envíos y spam de `form_submissions`), agrupados por día en
 * la zona del workspace. Acá solo se resume y se calculan las tasas.
 */

export interface DailyRow {
  day: string; // YYYY-MM-DD
  views: number;
  starts: number;
  submissions: number;
  spam: number;
  rejected: number;
}

export interface MetricsSummary {
  views: number;
  starts: number;
  submissions: number;
  spam: number;
  rejected: number;
  /** envíos / vistas, o null si no hubo vistas. */
  conversion: number | null;
  /** inicios / vistas, o null si no hubo vistas. */
  startRate: number | null;
}

/** Con 0 vistas no hay tasa: se muestra "—", no 0 % ni infinito. */
export function conversionRate(submissions: number, views: number): number | null {
  if (!views || views <= 0) return null;
  return submissions / views;
}

export function startRate(starts: number, views: number): number | null {
  if (!views || views <= 0) return null;
  return starts / views;
}

export function summarize(rows: DailyRow[]): MetricsSummary {
  const total = rows.reduce(
    (acc, r) => ({
      views: acc.views + (r.views || 0),
      starts: acc.starts + (r.starts || 0),
      submissions: acc.submissions + (r.submissions || 0),
      spam: acc.spam + (r.spam || 0),
      rejected: acc.rejected + (r.rejected || 0),
    }),
    { views: 0, starts: 0, submissions: 0, spam: 0, rejected: 0 },
  );
  return {
    ...total,
    conversion: conversionRate(total.submissions, total.views),
    startRate: startRate(total.starts, total.views),
  };
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits).replace(".", ",")} %`;
}

export const MAX_RANGE_DAYS = 366;

export const PERIOD_OPTIONS = [
  { value: "7", label: "Últimos 7 días", days: 7 },
  { value: "30", label: "Últimos 30 días", days: 30 },
  { value: "90", label: "Últimos 90 días", days: 90 },
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  return formatDay(parseDay(day) + delta * 86_400_000);
}

export interface Period {
  from: string;
  to: string;
}

/**
 * El período pedido en la URL, validado: `?dias=30` o `?desde=…&hasta=…`.
 * `today` es la fecha de hoy en la zona del workspace.
 */
export function resolvePeriod(
  params: { dias?: string | null; desde?: string | null; hasta?: string | null },
  today: string,
): Period {
  if (params.desde && params.hasta && DATE_RE.test(params.desde) && DATE_RE.test(params.hasta)) {
    let from = params.desde;
    let to = params.hasta;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    const span = (parseDay(to) - parseDay(from)) / 86_400_000 + 1;
    if (span > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
    return { from, to };
  }
  const option = PERIOD_OPTIONS.find((p) => p.value === params.dias) ?? PERIOD_OPTIONS[1];
  return { from: addDays(today, -(option.days - 1)), to: today };
}

/**
 * El día (YYYY-MM-DD) en que cae un instante en una zona. Es la misma cuenta que
 * hace `form_metrics_daily` en la base: un envío a las 23:30 de Costa Rica
 * cuenta en ESE día y no en el siguiente de UTC.
 */
export function dayInZone(instant: Date | string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
  return parts;
}
