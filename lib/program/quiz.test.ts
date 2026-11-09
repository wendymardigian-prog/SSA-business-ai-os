// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import quizCases from "./quiz-grade.cases.json";
import gradingCases from "./grading.cases.json";
import { gradeQuiz, quizDefinitionIssues, type QuizSettings } from "./quiz";
import { gradingIssues, passedFor } from "./grading";

describe("la nota de una evaluación (casos compartidos con la base)", () => {
  for (const c of quizCases.cases) it(c.name, () => expect(gradeQuiz(c.settings as QuizSettings, c.answers as Record<string, unknown>, c.attempt)).toEqual(c.expected));
  it("hay al menos 12 casos", () => expect(quizCases.cases.length).toBeGreaterThanOrEqual(12));
});

describe("si una calificación aprueba (casos compartidos con la base)", () => {
  for (const c of gradingCases.cases) it(c.name, () => expect(passedFor(c.scale, c.value, c.passAt)).toBe(c.expected));
});

describe("lo que se revisa antes de guardar", () => {
  const fields = [
    { key: "q1", type: "single_select", options: ["A", "B"] },
    { key: "q2", type: "multi_select", options: ["A", "B"] },
    { key: "t", type: "short_text" },
  ];
  it("una evaluación", () => {
    expect(quizDefinitionIssues({ pass_pct: 70, questions: { q1: { points: 1, correct: ["A"] } } }, fields)).toEqual([]);
    expect(quizDefinitionIssues({ pass_pct: 0, questions: { q1: { points: 1, correct: [] } } }, fields)).toEqual(["el % para aprobar va de 1 a 100", "«q1»: marcá la respuesta correcta"]);
    expect(quizDefinitionIssues({ questions: { q2: { points: 1, correct: ["A", "B"] } } }, fields)).toContain("«q2»: no pueden ser todas correctas");
    expect(quizDefinitionIssues({ questions: { t: { points: 1, correct: ["x"] } } }, fields)).toContain("«t»: solo preguntas de selección");
  });
  it("una calificación", () => {
    expect(gradingIssues({ enabled: false })).toEqual([]);
    expect(gradingIssues({ enabled: true, scale: "otra" })).toEqual(["elegí la escala"]);
    expect(gradingIssues({ enabled: true, scale: "stars", pass_at: 7 })).toEqual(["«aprueba desde» tiene que ser un valor de la escala"]);
    expect(gradingIssues({ enabled: true, scale: "words", pass_at: "bueno" })).toEqual([]);
  });
});
