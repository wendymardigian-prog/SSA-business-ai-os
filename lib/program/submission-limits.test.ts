// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./submission-limits.cases.json";
import { submissionLimitsIssues, submissionPlan, type SubmissionHistoryRow, type SubmissionLimits } from "./submission-limits";

describe("si se puede entregar otra vez (casos compartidos con la base)", () => {
  for (const c of cases.cases) it(c.name, () => expect(submissionPlan(c.limits as SubmissionLimits | null, c.history as SubmissionHistoryRow[])).toEqual(c.expected));
  it("hay al menos 12 casos", () => expect(cases.cases.length).toBeGreaterThanOrEqual(12));
});

describe("los límites al guardar la actividad", () => {
  it("valores válidos", () => {
    expect(submissionLimitsIssues({ before_review: null, after_review: 2 })).toEqual([]);
    expect(submissionLimitsIssues({ before_review: 0, after_review: 100 })).toEqual([]);
    expect(submissionLimitsIssues(null)).toEqual([]);
  });
  it("valores fuera de rango", () => {
    expect(submissionLimitsIssues({ before_review: -1 })).toHaveLength(1);
    expect(submissionLimitsIssues({ before_review: 1.5, after_review: 101 })).toHaveLength(2);
  });
});
