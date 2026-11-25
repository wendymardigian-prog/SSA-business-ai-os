// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { activityAnswersValid, ratingBounds, type AnswerField } from "./activity-answers";
import data from "./activity-answers.cases.json";

const cases = data.cases as Array<{ name: string; fields: AnswerField[]; answers: Record<string, unknown>; expected: boolean }>;

describe("respuestas de estrellas y opciones (gemela de activity_answers_valid)", () => {
  for (const c of cases) it(c.name, () => expect(activityAnswersValid(c.fields, c.answers)).toBe(c.expected));

  it("las estrellas van de 1 a 5 si la pregunta no dice otra cosa", () => {
    expect(ratingBounds({})).toEqual({ min: 1, max: 5 });
    expect(ratingBounds({ min: 0, max: 10 })).toEqual({ min: 0, max: 10 });
  });
});
