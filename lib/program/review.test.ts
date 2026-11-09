// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { matchesReviewFilter, reviewRowView, type ReviewSubmission } from "./review";

const base: ReviewSubmission = { id: "s", formType: "activity", reviewStatus: "pending", grade: null, gradingEnabled: false, createdAt: "2026-11-08T00:00:00Z" };

describe("Por revisar", () => {
  it("una actividad sin calificación pendiente: revisar", () => expect(reviewRowView(base)).toMatchObject({ stateLabel: "Por revisar", action: "review", tone: "todo" }));
  it("con calificación: calificar", () => expect(reviewRowView({ ...base, gradingEnabled: true })).toMatchObject({ stateLabel: "Por calificar", action: "grade" }));
  it("a corregir", () => expect(reviewRowView({ ...base, reviewStatus: "needs_changes" })).toMatchObject({ stateLabel: "A corregir", tone: "warn" }));
  it("revisada", () => expect(reviewRowView({ ...base, reviewStatus: "reviewed" }).stateLabel).toBe("Revisada"));
  it("calificada con estrellas", () =>
    expect(reviewRowView({ ...base, reviewStatus: "reviewed", gradingEnabled: true, grade: { scale: "stars", value: 4, passed: true } })).toMatchObject({ stateLabel: "Calificada · aprobó", gradeLabel: "4 ★" }));
  it("una evaluación solo muestra su resultado", () => {
    expect(reviewRowView({ ...base, formType: "quiz", reviewStatus: "graded", grade: { pct: 80, passed: true, counted: true } })).toMatchObject({ kindLabel: "Evaluación", stateLabel: "Aprobó", action: "view", gradeLabel: "80 %" });
    expect(reviewRowView({ ...base, formType: "quiz", grade: { pct: 90, passed: true, counted: false } }).stateLabel).toBe("Fuera de intentos");
  });
  it("los filtros", () => {
    expect(matchesReviewFilter(base, "pending")).toBe(true);
    expect(matchesReviewFilter({ ...base, formType: "quiz" }, "pending")).toBe(false);
    expect(matchesReviewFilter({ ...base, formType: "quiz" }, "quiz")).toBe(true);
    expect(matchesReviewFilter({ ...base, reviewStatus: "reviewed" }, "reviewed")).toBe(true);
  });
});
