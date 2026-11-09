// @plantilla-quitar(servicios)
/**
 * Portal › Por revisar (F57), puro: el estado y la acción de cada entrega.
 */
import { SCALE_LABELS, WORD_LABELS } from "./grading";

export interface ReviewSubmission {
  id: string;
  formType: "quiz" | "activity";
  reviewStatus: "pending" | "graded" | "reviewed" | "needs_changes" | null;
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

export function matchesReviewFilter(s: ReviewSubmission, f: ReviewFilter): boolean {
  if (f === "all") return true;
  if (f === "quiz") return s.formType === "quiz";
  if (s.formType === "quiz") return false;
  if (f === "pending") return s.reviewStatus === "pending" || s.reviewStatus === null;
  return s.reviewStatus === f;
}
