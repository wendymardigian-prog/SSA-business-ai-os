import { describe, it, expect } from "vitest";
import { withAnswerConditions } from "./answer-conditions";

const trigger = { triggerType: "form_submitted", form_ids: ["11111111-1111-4111-8111-111111111111"], nps_categories: ["detractor"] };
const rule = { rootConjunction: "and", conditions: [{ id: "c_1", fieldKey: "edad", operator: "gte", value: "18" }], groups: [] };

describe("withAnswerConditions", () => {
  it("sin nada que cambiar (undefined) deja el disparador como esta", () => {
    expect(withAnswerConditions(trigger, undefined)).toEqual({ ok: true, data: trigger });
  });

  it("pone el 'Solo si…' en el MISMO formato de siempre y no toca el resto del disparador", () => {
    const out = withAnswerConditions(trigger, rule);
    expect(out).toEqual({ ok: true, data: { ...trigger, answer_conditions: rule } });
  });

  it("vacio o null lo saca", () => {
    const withRule = { ...trigger, answer_conditions: rule };
    for (const empty of [null, { rootConjunction: "and", conditions: [], groups: [] }, { rootConjunction: "and", conditions: [], groups: [{ conjunction: "or", conditions: [] }] }]) {
      const out = withAnswerConditions(withRule, empty);
      expect(out.ok && "answer_conditions" in out.data).toBe(false);
    }
  });

  it("una regla invalida se rechaza", () => {
    expect(withAnswerConditions(trigger, { rootConjunction: "xor", conditions: [], groups: [] }).ok).toBe(false);
    expect(withAnswerConditions(trigger, { rootConjunction: "and", conditions: [{ fieldKey: "x", operator: "inventado", value: "" }], groups: [] }).ok).toBe(false);
    expect(withAnswerConditions(trigger, "texto").ok).toBe(false);
  });

  it("un contrato firmado no admite condiciones (pero sacarlas esta bien)", () => {
    const contract = { triggerType: "contract_signed", form_ids: [] };
    expect(withAnswerConditions(contract, rule).ok).toBe(false);
    expect(withAnswerConditions(contract, null)).toEqual({ ok: true, data: contract });
  });
});
