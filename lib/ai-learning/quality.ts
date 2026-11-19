import { REJECT_REASONS, REJECT_REASON_LABELS, type RejectReason } from "./reject-reasons";

/**
 * Panel de calidad. Puro: convierte lo que devuelve `ai_quality_weekly` (00441) en filas para la pantalla.
 *
 * - Tasa de aprobación = aprobadas tal cual / decididas.
 * - Tasa de edición = aprobadas con edición / decididas.
 * - Motivos de rechazo por semana, de la lista cerrada.
 * Una semana sin decisiones no tiene tasa: «Sin dato» (null), nunca 0 %.
 */

export interface QualityWeekRaw {
  week_start: string;
  decided: number;
  approved: number;
  approved_edited: number;
  rejected: number;
  reasons: unknown;
}

export interface QualityWeek {
  weekStart: string;
  decided: number;
  approved: number;
  edited: number;
  rejected: number;
  /** 0 a 100, o null sin decisiones. */
  approvalRate: number | null;
  editRate: number | null;
  rejectionRate: number | null;
  reasons: Array<{ reason: string; label: string; count: number }>;
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

export function rate(part: number, total: number): number | null {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function reasonsOf(raw: unknown): QualityWeek["reasons"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const entries = Object.entries(raw as Record<string, unknown>).map(([reason, count]) => ({
    reason,
    label: REJECT_REASON_LABELS[reason as RejectReason] ?? "Sin motivo",
    count: num(count),
  }));
  const order = (r: string) => {
    const i = (REJECT_REASONS as readonly string[]).indexOf(r);
    return i === -1 ? 99 : i;
  };
  return entries.filter((e) => e.count > 0).sort((a, b) => b.count - a.count || order(a.reason) - order(b.reason));
}

export function qualityWeeks(rows: readonly QualityWeekRaw[] | null | undefined): QualityWeek[] {
  return (rows ?? [])
    .map((r) => {
      const decided = num(r.decided);
      const approved = num(r.approved);
      const edited = num(r.approved_edited);
      const rejected = num(r.rejected);
      return {
        weekStart: String(r.week_start).slice(0, 10),
        decided,
        approved,
        edited,
        rejected,
        approvalRate: rate(approved, decided),
        editRate: rate(edited, decided),
        rejectionRate: rate(rejected, decided),
        reasons: reasonsOf(r.reasons),
      };
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** El total del período (sobre todas las decisiones, no el promedio de las semanas). */
export function qualityTotals(weeks: readonly QualityWeek[]): Omit<QualityWeek, "weekStart"> {
  const decided = weeks.reduce((s, w) => s + w.decided, 0);
  const approved = weeks.reduce((s, w) => s + w.approved, 0);
  const edited = weeks.reduce((s, w) => s + w.edited, 0);
  const rejected = weeks.reduce((s, w) => s + w.rejected, 0);
  const byReason = new Map<string, number>();
  for (const w of weeks) for (const r of w.reasons) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + r.count);
  return {
    decided,
    approved,
    edited,
    rejected,
    approvalRate: rate(approved, decided),
    editRate: rate(edited, decided),
    rejectionRate: rate(rejected, decided),
    reasons: reasonsOf(Object.fromEntries(byReason)),
  };
}

export function formatRate(value: number | null): string {
  return value === null ? "Sin dato" : `${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;
}
