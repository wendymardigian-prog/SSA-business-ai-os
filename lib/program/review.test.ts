// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { REVIEW_FILTERS, matchesReviewFilter, parseReviewFilter, reviewFilterCounts, reviewRowView, type ReviewSubmission } from "./review";

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


describe("Por revisar: el filtro rapido de la barra (Servicios A2)", () => {
  const base = { formType: "activity", reviewStatus: null, gradingEnabled: false, grade: null } as never;
  it("lee ?filtro= y cae a pendientes con lo que no conoce", () => {
    expect(parseReviewFilter("reviewed")).toBe("reviewed");
    expect(parseReviewFilter("otra")).toBe("pending");
    expect(parseReviewFilter(undefined)).toBe("pending");
  });
  it("cuenta cada opcion con la misma regla que filtra", () => {
    const items = [
      { ...(base as object), reviewStatus: "pending" },
      { ...(base as object), reviewStatus: "reviewed" },
      { ...(base as object), formType: "quiz", reviewStatus: "graded" },
    ] as never[];
    const c = reviewFilterCounts(items);
    expect(c).toEqual({ pending: 1, needs_changes: 0, reviewed: 1, quiz: 1, all: 3 });
    expect(REVIEW_FILTERS.map((f) => f.key)).toEqual(["pending", "needs_changes", "reviewed", "quiz", "all"]);
  });
});
