// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./journey-template.cases.json";
import { journeySummary, newJourneyKey, validateJourneyTemplate, ITEM_KEY, PHASE_KEY, type JourneyTemplate } from "./journey-template";

describe("validateJourneyTemplate (gemela de app_servicio.validate_journey_template)", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(validateJourneyTemplate(c.template)).toEqual(c.expected);
    });
  }

  const PRODUCT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const QUIZ_OTHER = "11111111-1111-4111-8111-111111111111";
  const ACT_NO_GRADE = "22222222-2222-4222-8222-222222222222";
  const ctx = {
    productId: PRODUCT,
    forms: {
      [QUIZ_OTHER]: { type: "quiz", productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      [ACT_NO_GRADE]: { type: "activity", productId: PRODUCT, grading: false },
    },
  };
  const one = (item: Record<string, unknown>) => ({ v: 1, phases: [{ key: "ph_aaaaa1", name: "Fase", items: [{ key: "it_aaaaa1", name: "Paso", ...item }] }] });

  it("una evaluación de otro programa se rechaza", () => {
    expect(validateJourneyTemplate(one({ kind: "quiz", ref: { form_id: QUIZ_OTHER } }), ctx)).toEqual(["la evaluación tiene que ser de este programa"]);
  });
  it("«al aprobar» en una actividad sin calificación se rechaza", () => {
    expect(validateJourneyTemplate(one({ kind: "activity", ref: { form_id: ACT_NO_GRADE, complete_on: "passed" } }), ctx)).toEqual([
      "«Paso»: «al aprobar» necesita una actividad con calificación",
    ]);
  });
});

describe("claves y resumen", () => {
  it("las claves nuevas tienen la forma estable", () => {
    expect(newJourneyKey("ph")).toMatch(PHASE_KEY);
    expect(newJourneyKey("it")).toMatch(ITEM_KEY);
  });
  it("resume fases, pasos y días", () => {
    const t: JourneyTemplate = {
      v: 1,
      phases: [
        { key: "ph_aaaaa1", name: "A", duration_days: 14, items: [{ key: "it_aaaaa1", kind: "checkbox", name: "x" }] },
        { key: "ph_aaaaa2", name: "B", duration_days: 70, items: [] },
      ],
    };
    expect(journeySummary(t)).toEqual({ phases: 2, items: 1, days: 84 });
    expect(journeySummary({ v: 1, phases: [{ key: "ph_aaaaa1", name: "A", items: [] }] }).days).toBeNull();
  });
});
