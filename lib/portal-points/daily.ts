// @plantilla-quitar(servicios)
/**
 * El gráfico «Actividad en el portal» de las fichas (F130.4), puro. Recibe lo que devuelve `svc_points_daily` (00380):
 * un día por fila, en la zona del estudiante, con los puntos positivos por grupo, los negativos aparte y si entró.
 *
 * - Cada barra se apila por grupo, siempre en el mismo orden (`POINT_GROUPS`); los negativos NO dibujan barra.
 * - Un día sin entrar puede tener puntos (me gusta recibidos, un paso que completó el equipo): se marca igual.
 * - Arriba: días que entró de N, los puntos del período (netos) y por día, y el total por grupo para la leyenda.
 */
import { POINT_GROUPS } from "./rules";

export interface DailyRow {
  day: string;
  active: boolean;
  groups: Record<string, number>;
  negative: number;
}

export interface DailyBar {
  day: string;
  active: boolean;
  /** Los grupos con puntos, en el orden fijo, con su alto relativo al día más alto (0 a 1). */
  segments: Array<{ group: string; label: string; points: number; share: number }>;
  positive: number;
  negative: number;
  /** El texto para el lector de pantalla y el tooltip. */
  text: string;
}

export interface DailyActivityView {
  bars: DailyBar[];
  activeDays: number;
  totalDays: number;
  periodPoints: number;
  perDay: number;
  /** Para la leyenda: solo los grupos con puntos en el período, en el orden fijo. */
  legend: Array<{ group: string; label: string; points: number }>;
  negativeTotal: number;
  max: number;
}

const LABEL: Record<string, string> = Object.fromEntries(POINT_GROUPS.map((g) => [g.key, g.label]));
const ORDER = POINT_GROUPS.map((g) => g.key as string);

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};

export function dailyActivityView(rows: readonly DailyRow[]): DailyActivityView {
  const positives = rows.map((r) => Object.values(r.groups ?? {}).reduce((a, b) => a + (b > 0 ? b : 0), 0));
  const max = Math.max(0, ...positives);
  const totals: Record<string, number> = {};
  let negativeTotal = 0;
  const bars = rows.map((r, i) => {
    const groups = r.groups ?? {};
    const keys = [...ORDER.filter((k) => (groups[k] ?? 0) > 0), ...Object.keys(groups).filter((k) => !ORDER.includes(k) && groups[k] > 0)];
    const segments = keys.map((k) => {
      totals[k] = (totals[k] ?? 0) + groups[k];
      return { group: k, label: LABEL[k] ?? k, points: groups[k], share: max > 0 ? groups[k] / max : 0 };
    });
    const negative = Math.min(0, r.negative ?? 0);
    negativeTotal += negative;
    const parts = [
      `${fmtDay(r.day)}: ${r.active ? "entró" : "no entró"}`,
      positives[i] > 0 ? `${positives[i]} ${positives[i] === 1 ? "punto" : "puntos"} (${segments.map((s) => `${s.label} ${s.points}`).join(", ")})` : "sin puntos",
      ...(negative < 0 ? [`ajustes ${negative}`] : []),
    ];
    return { day: r.day, active: r.active, segments, positive: positives[i], negative, text: parts.join(" · ") };
  });
  const positiveTotal = positives.reduce((a, b) => a + b, 0);
  const periodPoints = positiveTotal + negativeTotal;
  return {
    bars,
    activeDays: rows.filter((r) => r.active).length,
    totalDays: rows.length,
    periodPoints,
    perDay: rows.length ? Math.round((periodPoints / rows.length) * 10) / 10 : 0,
    legend: [...ORDER, ...Object.keys(totals).filter((k) => !ORDER.includes(k))].filter((k) => (totals[k] ?? 0) > 0).map((k) => ({ group: k, label: LABEL[k] ?? k, points: totals[k] })),
    negativeTotal,
    max,
  };
}

/** Las mini barras de 30 días de Clientes: el alto relativo de cada día (0 a 1). */
export function miniBarsView(bars: readonly number[]): { heights: number[]; total: number } {
  const max = Math.max(0, ...bars);
  return { heights: bars.map((b) => (max > 0 && b > 0 ? b / max : 0)), total: bars.reduce((a, b) => a + (b > 0 ? b : 0), 0) };
}

/** Qué dice cada fila del historial. Un descuento (`<origen>:revoked`) trae el mismo origen, puntos negativos y su motivo. */
export const HISTORY_KIND_LABELS: Record<string, string> = {
  lesson: "Clase vista",
  module: "Módulo terminado",
  all_content: "Todo el contenido",
  step: "Paso completado",
  phase: "Fase completada",
  journey: "Camino completado",
  submit: "Actividad entregada",
  pass: "Actividad aprobada",
  quiz_pass: "Evaluación aprobada",
  attendance: "Asistió a una clase en vivo",
  post: "Publicó en la comunidad",
  comment: "Comentó",
  like: "Recibió un «me gusta»",
  ref_lead: "Lead con su código",
  ref_booking: "Su referido agendó",
  ref_sale: "Su referido compró",
  manual: "Ajuste del equipo",
};

export function historyLabel(kind: string, points: number): string {
  const base = HISTORY_KIND_LABELS[kind] ?? "Puntos";
  return points < 0 && kind !== "manual" ? `Descuento · ${base}` : base;
}
