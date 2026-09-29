/**
 * La tarjeta "Aprobación de respuestas" y el aviso de borradores de arriba.
 *
 * Dos cosas que importan:
 *
 *   - **La referencia del 85 %** es una referencia visual, no una regla: si los
 *     borradores se aprueban sin cambios por arriba de eso, conviene evaluar
 *     pasar el canal a envio directo. La decision la toma una persona.
 *   - **Descartar a proposito no es una ventana perdida.** Son dos resultados
 *     distintos y mezclarlos haria ver mal un trabajo bien hecho.
 */

import { share } from "./comparisons";

/** La fila de `chat_dashboard_drafts`. */
export interface DraftsSqlRow {
  approved_unchanged: number;
  corrected: number;
  answered_manually: number;
  discarded: number;
  window_missed: number;
  agent_median_s: number | null;
  approval_median_s: number | null;
  pending_now: number;
  pending_under_6h: number;
  missed_last_7d: number;
  unedited_weekly: unknown;
}

export type DraftOutcomeKey = "approved_unchanged" | "corrected" | "answered_manually" | "discarded" | "window_missed";

export interface DraftOutcome {
  key: DraftOutcomeKey;
  label: string;
  color: string;
  count: number;
  percent: number | null;
}

const OUTCOME_META: Array<{ key: DraftOutcomeKey; label: string; color: string }> = [
  { key: "approved_unchanged", label: "Aprobada sin cambios", color: "var(--c-agent)" },
  { key: "corrected", label: "Corregida antes de enviar", color: "var(--c-team)" },
  { key: "answered_manually", label: "Respondida a mano", color: "var(--c-auto)" },
  { key: "discarded", label: "Descartada", color: "var(--c-ext)" },
  { key: "window_missed", label: "Ventana perdida", color: "var(--bad)" },
];

/** La referencia de §6: 85 % aprobados sin cambios. */
export const DIRECT_SEND_REFERENCE_PCT = 85;

export interface DraftsCard {
  outcomes: DraftOutcome[];
  total: number;
  agentMedianSeconds: number | null;
  approvalMedianSeconds: number | null;
  pendingNow: number;
  pendingUnder6h: number;
  missedLast7d: number;
  /** Ocho semanas del % aprobado sin cambios; null en las semanas sin envios. */
  uneditedWeekly: Array<number | null>;
  /** Si conviene evaluar pasar a envio directo (referencia, no regla). */
  aboveReference: boolean;
}

interface WeeklyEntry {
  week_start?: unknown;
  sent?: unknown;
  unedited?: unknown;
  pct?: unknown;
}

/** Lee el jsonb de las 8 semanas con tolerancia: es dato de la base. */
export function parseUneditedWeekly(raw: unknown): Array<number | null> {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const e = entry as WeeklyEntry;
    if (e?.pct === null || e?.pct === undefined) return null;
    const n = Number(e.pct);
    return Number.isFinite(n) ? n : null;
  });
}

export function draftsCard(row: DraftsSqlRow | null): DraftsCard {
  const counts: Record<DraftOutcomeKey, number> = {
    approved_unchanged: Number(row?.approved_unchanged ?? 0),
    corrected: Number(row?.corrected ?? 0),
    answered_manually: Number(row?.answered_manually ?? 0),
    discarded: Number(row?.discarded ?? 0),
    window_missed: Number(row?.window_missed ?? 0),
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const uneditedWeekly = parseUneditedWeekly(row?.unedited_weekly);
  const last = [...uneditedWeekly].reverse().find((v) => v !== null) ?? null;

  return {
    outcomes: OUTCOME_META.map((m) => ({ ...m, count: counts[m.key], percent: share(counts[m.key], total) })),
    total,
    agentMedianSeconds: row?.agent_median_s === null || row?.agent_median_s === undefined ? null : Number(row.agent_median_s),
    approvalMedianSeconds:
      row?.approval_median_s === null || row?.approval_median_s === undefined ? null : Number(row.approval_median_s),
    pendingNow: Number(row?.pending_now ?? 0),
    pendingUnder6h: Number(row?.pending_under_6h ?? 0),
    missedLast7d: Number(row?.missed_last_7d ?? 0),
    uneditedWeekly,
    aboveReference: last !== null && last >= DIRECT_SEND_REFERENCE_PCT,
  };
}

/**
 * ¿Se muestra el aviso de borradores arriba del dashboard? (F17)
 *
 * Solo si algun canal deja borradores Y el filtro es uno donde el agente tiene
 * algo que ver. Con el filtro en Automatizaciones, el aviso no viene al caso.
 */
export function showDraftAlert(args: {
  hasDraftChannels: boolean;
  author: string | null;
  pendingNow: number;
}): boolean {
  if (!args.hasDraftChannels) return false;
  if (args.pendingNow <= 0) return false;
  if (args.author === "automations" || args.author === "external") return false;
  return true;
}

/** El texto del aviso: pendientes, por vencer y ventanas perdidas. */
export function draftAlertText(card: Pick<DraftsCard, "pendingNow" | "pendingUnder6h" | "missedLast7d">): {
  headline: string;
  detail: string;
} {
  const headline =
    card.pendingNow === 1
      ? "1 respuesta del agente esperando aprobación"
      : `${card.pendingNow} respuestas del agente esperando aprobación`;
  const parts: string[] = [];
  if (card.pendingUnder6h > 0) {
    parts.push(card.pendingUnder6h === 1 ? "1 con menos de 6 h de ventana" : `${card.pendingUnder6h} con menos de 6 h de ventana`);
  }
  parts.push(
    card.missedLast7d === 1
      ? "1 ventana perdida en los últimos 7 días"
      : `${card.missedLast7d} ventanas perdidas en los últimos 7 días`,
  );
  return { headline, detail: parts.join(" · ") };
}
