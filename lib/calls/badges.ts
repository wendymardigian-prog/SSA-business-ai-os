/**
 * El UNICO mapa de colores de los chips de Llamadas (tipo, estado, resultado,
 * calificacion y puntaje). Portado de prevxcrm (`meetingBadgeStyles.ts`) con
 * las clases de SSA (Tailwind, claro y oscuro) y el vocabulario de estados de
 * la base. Lo usan la lista, la ficha, la ficha del contacto y el dashboard.
 *
 * Puntajes (plano §13.0): ambar por debajo de 50, verde desde 65. En el medio,
 * neutro. Es el mismo criterio en el numero, en la barra y en el chip.
 */

export type CallBadgeTone = "neutral" | "info" | "classification" | "positive" | "review" | "negative";

export const CALL_BADGE_BASE = "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap";

export const CALL_BADGE_TONES: Record<CallBadgeTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  classification: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  review: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  negative: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

const normalized = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/[ -]+/g, "_");

/** Estado de la agenda vinculada. */
export function bookingBadgeTone(status: string | null | undefined): CallBadgeTone {
  const value = normalized(status);
  if (["sale", "confirmed"].includes(value)) return "positive";
  if (["no_show", "not_qualified", "cancelled_not_qualified", "cancelled_no_response", "cancelled_other"].includes(value)) return "negative";
  if (["rescheduled", "followup_warm", "followup_cold"].includes(value)) return "review";
  if (["scheduled"].includes(value)) return "info";
  return "neutral";
}

/** Resultado de la llamada (`resultado.categoria`). */
export function outcomeBadgeTone(outcome: string | null | undefined): CallBadgeTone {
  const value = normalized(outcome);
  if (!value) return "neutral";
  if (value.includes("sin_fecha")) return "negative";
  if (value.startsWith("no_")) return "negative";
  if (value.includes("venta") || value === "cerro" || value === "cerró") return "positive";
  if (value.includes("seguimiento") || value.includes("reagenda")) return "info";
  if (["descalificado", "no_califica", "no_show", "perdido", "perdida"].includes(value)) return "negative";
  return "neutral";
}

/** Estado del analisis (`calls.analysis_status`). */
export function analysisBadgeTone(status: string | null | undefined): CallBadgeTone {
  switch (normalized(status)) {
    case "analyzing":
    case "classifying":
      return "info";
    case "analyzed":
      return "positive";
    case "needs_review":
    case "pending":
      return "review";
    case "error":
      return "negative";
    default:
      return "neutral"; // not_applicable
  }
}

/** Calificacion del lead. */
export function qualificationBadgeTone(q: string | null | undefined): CallBadgeTone {
  if (q === "calificado") return "positive";
  if (q === "con_reservas") return "review";
  if (q === "no_calificado") return "negative";
  return "neutral";
}

/** El tipo de llamada: de venta (morado) o de otra cosa (neutro); "por revisar" lo marca el estado. */
export function typeBadgeTone(type: string | null | undefined): CallBadgeTone {
  return type ? "classification" : "neutral";
}

/** Ambar por debajo de 50, verde desde 65, neutro en el medio. */
export function scoreBadgeTone(score: number | null | undefined): CallBadgeTone {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return "neutral";
  const value = Number(score) || 0;
  if (value >= 65) return "positive";
  if (value < 50) return "review";
  return "neutral";
}

export function callBadgeClass(tone: CallBadgeTone): string {
  return `${CALL_BADGE_BASE} ${CALL_BADGE_TONES[tone]}`;
}

/** El color de la barra de un puntaje (misma regla que scoreBadgeTone). */
export function scoreBarClass(score: number | null | undefined): string {
  const tone = scoreBadgeTone(score);
  if (tone === "positive") return "bg-emerald-500";
  if (tone === "review") return "bg-amber-500";
  return "bg-muted-foreground/50";
}
