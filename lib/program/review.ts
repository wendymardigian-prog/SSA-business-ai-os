// @plantilla-quitar(servicios)
/**
 * Portal › Por revisar (F57), puro: el estado y la acción de cada entrega.
 */
import { SCALE_LABELS, WORD_LABELS } from "./grading";

export interface ReviewSubmission {
  id: string;
  formType: "quiz" | "activity";
  reviewStatus: "pending" | "graded" | "reviewed" | "needs_changes" | "superseded" | null;
  grade: { pct?: number; passed?: boolean; counted?: boolean; scale?: string; value?: unknown } | null;
  gradingEnabled: boolean;
  createdAt: string;
}

export interface ReviewRowView {
  kindLabel: string;
  stateLabel: string;
  tone: "todo" | "warn" | "done" | "info";
  action: "review" | "grade" | "view";
  gradeLabel: string | null;
}

export function gradeLabel(grade: ReviewSubmission["grade"]): string | null {
  if (!grade) return null;
  if (typeof grade.pct === "number") return `${grade.pct} %`;
  if (grade.scale === "pass") return grade.value === "approved" ? "Aprobada" : "No aprobada";
  if (grade.scale === "words") return WORD_LABELS[grade.value as keyof typeof WORD_LABELS] ?? null;
  if (grade.scale === "stars") return `${grade.value} ★`;
  if (typeof grade.value === "number") return `${grade.value} (${SCALE_LABELS[grade.scale as keyof typeof SCALE_LABELS] ?? ""})`.trim();
  return null;
}

export function reviewRowView(s: ReviewSubmission): ReviewRowView {
  if (s.formType === "quiz") {
    const counted = s.grade?.counted !== false;
    return {
      kindLabel: "Evaluación",
      stateLabel: !counted ? "Fuera de intentos" : s.grade?.passed ? "Aprobó" : "No aprobó",
      tone: s.grade?.passed ? "done" : "info",
      action: "view",
      gradeLabel: gradeLabel(s.grade),
    };
  }
  if (s.reviewStatus === "superseded") return { kindLabel: "Actividad", stateLabel: "Reemplazada", tone: "info", action: "view", gradeLabel: null };
  if (s.reviewStatus === "needs_changes") return { kindLabel: "Actividad", stateLabel: "A corregir", tone: "warn", action: "view", gradeLabel: null };
  if (s.reviewStatus === "reviewed") {
    return {
      kindLabel: "Actividad",
      stateLabel: s.gradingEnabled ? (s.grade?.passed ? "Calificada · aprobó" : "Calificada · no aprobó") : "Revisada",
      tone: "done",
      action: "view",
      gradeLabel: gradeLabel(s.grade),
    };
  }
  return { kindLabel: "Actividad", stateLabel: s.gradingEnabled ? "Por calificar" : "Por revisar", tone: "todo", action: s.gradingEnabled ? "grade" : "review", gradeLabel: null };
}

export type ReviewFilter = "pending" | "needs_changes" | "reviewed" | "quiz" | "all";

/** Los filtros de Por revisar, en el orden de la barra (filtro rapido). */
export const REVIEW_FILTERS: ReadonlyArray<{ key: ReviewFilter; label: string }> = [
  { key: "pending", label: "Por revisar o calificar" },
  { key: "needs_changes", label: "A corregir" },
  { key: "reviewed", label: "Revisadas" },
  { key: "quiz", label: "Resultados de evaluaciones" },
  { key: "all", label: "Todo" },
];

/** `?filtro=` de la URL; lo que no se conoce es "pending" (lo de siempre). */
export function parseReviewFilter(v: string | null | undefined): ReviewFilter {
  return REVIEW_FILTERS.some((f) => f.key === v) ? (v as ReviewFilter) : "pending";
}

/** Cuantas entregas hay con cada filtro (para el conteo del filtro rapido). */
export function reviewFilterCounts(items: readonly ReviewSubmission[]): Record<ReviewFilter, number> {
  const out = { pending: 0, needs_changes: 0, reviewed: 0, quiz: 0, all: 0 } as Record<ReviewFilter, number>;
  for (const f of REVIEW_FILTERS) out[f.key] = items.filter((s) => matchesReviewFilter(s, f.key)).length;
  return out;
}

export function matchesReviewFilter(s: ReviewSubmission, f: ReviewFilter): boolean {
  // Una entrega reemplazada (F126) no va en la lista: se ve en el historial de la persona.
  if (s.reviewStatus === "superseded") return false;
  if (f === "all") return true;
  if (f === "quiz") return s.formType === "quiz";
  if (s.formType === "quiz") return false;
  if (f === "pending") return s.reviewStatus === "pending" || s.reviewStatus === null;
  return s.reviewStatus === f;
}

/** Lo mínimo para armar el historial de entregas de una persona en una actividad (F126). */
export interface HistoryKey {
  id: string;
  formId: string;
  contactId: string | null;
  attempt: number | null;
  createdAt: string;
}

/** Las entregas de esa persona en esa actividad, de la primera a la última. */
export function submissionHistory<T extends HistoryKey>(items: readonly T[], of: HistoryKey): T[] {
  return items
    .filter((i) => i.formId === of.formId && i.contactId === of.contactId)
    .sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Si es la última entrega de esa persona (con límites, la base solo deja revisar esa: EV006). */
export function isLatestSubmission<T extends HistoryKey & { reviewStatus: ReviewSubmission["reviewStatus"] }>(items: readonly T[], of: T): boolean {
  const live = submissionHistory(items, of).filter((i) => i.reviewStatus !== "superseded");
  return live.length === 0 || live[live.length - 1].id === of.id;
}
