/**
 * La pestaña Reportes de un EOD (E9): la tabla por persona y día, los totales del período,
 * quién falta hoy y el CSV. Puro: la página lee (con el cliente de la persona: la RLS decide
 * qué reportes ve) y esto arma lo que se muestra.
 */
import { toCsv } from "@/lib/forms/export";
import { addDays, isIsoDate } from "./dates";
import { metricLabel, TOTAL_SCOPE, type EodMetrics } from "./metrics";

export interface EodReportListRow {
  id: string;
  userId: string;
  userName: string;
  reportDate: string;
  status: "draft" | "submitted";
  submittedAt: string | null;
  editedAt: string | null;
  editCount: number;
  metrics: EodMetrics;
  /** Los canales elegidos (solo de un reporte enviado). */
  channelKeys: string[];
}

export type ReportStatusLabel = "En curso" | "Enviado" | "Corregido";

export function reportStatusLabel(row: Pick<EodReportListRow, "status" | "editCount">): ReportStatusLabel {
  if (row.status === "draft") return "En curso";
  return row.editCount > 0 ? "Corregido" : "Enviado";
}

export interface MetricColumn {
  key: string;
  label: string;
}

/** Una columna por cada métrica que mide el reporte, en el orden de la definición. */
export function metricColumns(metricKeys: string[]): MetricColumn[] {
  return metricKeys.map((key) => ({ key, label: metricLabel(key) }));
}

/** El valor de una métrica en una fila: el total del día, o el de un canal si se filtra por canal. */
export function metricCell(row: EodReportListRow, key: string, channel: string | null): number | null {
  const scope = channel ?? TOTAL_SCOPE;
  const value = row.metrics?.[scope]?.[key];
  return typeof value === "number" ? value : null;
}

export interface PeriodTotals {
  /** Reportes enviados que entran en la suma. */
  reports: number;
  total: Record<string, number>;
  byChannel: Record<string, Record<string, number>>;
}

/**
 * Los totales del período: SOLO de los reportes enviados (un borrador no cuenta). Cada métrica
 * por canal y en total. Con un canal elegido, el total es el de ese canal.
 */
export function periodTotals(rows: EodReportListRow[], channel: string | null = null): PeriodTotals {
  const totals: PeriodTotals = { reports: 0, total: {}, byChannel: {} };
  for (const row of rows) {
    if (row.status !== "submitted") continue;
    totals.reports += 1;
    for (const [scope, values] of Object.entries(row.metrics ?? {})) {
      if (scope === TOTAL_SCOPE) {
        if (channel) continue;
        for (const [key, n] of Object.entries(values)) totals.total[key] = (totals.total[key] ?? 0) + n;
        continue;
      }
      if (scope === "general") continue;
      if (channel && scope !== channel) continue;
      totals.byChannel[scope] ??= {};
      for (const [key, n] of Object.entries(values)) {
        totals.byChannel[scope][key] = (totals.byChannel[scope][key] ?? 0) + n;
        if (channel) totals.total[key] = (totals.total[key] ?? 0) + n;
      }
    }
  }
  return totals;
}

// ── Filtros (en la URL) ──────────────────────────────────────────────────────

export interface ReportFilters {
  from: string;
  to: string;
  person: string | null;
  channel: string | null;
  page: number;
}

export const REPORTS_PAGE_SIZE = 100;
/** Como mucho 92 días por consulta: los totales se calculan sobre todo el período. */
export const MAX_RANGE_DAYS = 92;

export function parseReportFilters(params: Record<string, string | undefined>, today: string): ReportFilters {
  let to = isIsoDate(params.hasta) && params.hasta <= today ? params.hasta : today;
  let from = isIsoDate(params.desde) ? params.desde : addDays(to, -6);
  if (from > to) [from, to] = [to, from];
  if (from < addDays(to, -(MAX_RANGE_DAYS - 1))) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  const person = params.persona && /^[0-9a-f-]{36}$/i.test(params.persona) ? params.persona : null;
  const channel = params.canal && /^[a-z][a-z0-9_]{1,59}$/.test(params.canal) ? params.canal : null;
  const page = Math.max(1, Math.trunc(Number(params.pagina) || 1));
  return { from, to, person, channel, page };
}

/** Con un canal elegido, solo los reportes que lo eligieron. */
export function applyChannelFilter(rows: EodReportListRow[], channel: string | null): EodReportListRow[] {
  return channel ? rows.filter((r) => r.channelKeys.includes(channel)) : rows;
}

// ── Pendientes de hoy ────────────────────────────────────────────────────────

export interface PendingPerson {
  userId: string;
  name: string;
  state: "draft" | "none";
}

/**
 * Quiénes están en la audiencia y todavía no enviaron el de HOY, con el hoy de cada uno
 * (su zona horaria). `statusOf` dice el estado del reporte de esa persona en esa fecha.
 */
export function pendingToday(
  audience: Array<{ userId: string; name: string; today: string }>,
  statusOf: (userId: string, date: string) => "draft" | "submitted" | null,
): PendingPerson[] {
  return audience
    .flatMap((person) => {
      const status = statusOf(person.userId, person.today);
      if (status === "submitted") return [];
      return [{ userId: person.userId, name: person.name, state: status === "draft" ? ("draft" as const) : ("none" as const) }];
    })
    .sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name, "es") : a.state === "draft" ? -1 : 1));
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** El CSV: mismas protecciones que las respuestas (fórmulas, BOM). Las fechas, en la zona de quien exporta. */
export function buildReportsCsv(rows: EodReportListRow[], columns: MetricColumn[], options: { channel: string | null; formatDate: (iso: string) => string }): string {
  const header = ["Persona", "Fecha", "Estado", "Enviado", ...columns.map((c) => c.label)];
  const body = rows.map((row) => [
    row.userName,
    row.reportDate,
    reportStatusLabel(row),
    row.submittedAt ? options.formatDate(row.submittedAt) : "",
    ...columns.map((c) => {
      const value = metricCell(row, c.key, options.channel);
      return value === null ? "" : String(value);
    }),
  ]);
  // `toCsv` neutraliza las fórmulas (`protectCell`) y pone el BOM.
  return toCsv([header, ...body]);
}
