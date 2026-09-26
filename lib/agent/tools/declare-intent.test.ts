import { describe, it, expect } from "vitest";
import { validateIntent } from "./declare-intent";
import { evaluateRules, type Rule, type RuleContext } from "../rules/evaluate";

describe("validateIntent (F26)", () => {
  const valid = new Set(["cat-precio", "cat-cuando"]);
  it("intención válida se conserva", () => {
    expect(validateIntent({ category_id: "cat-precio", confidence: 0.9 }, valid)).toEqual({ category_id: "cat-precio", confidence: 0.9 });
  });
  it("category_id inexistente → null", () => {
    expect(validateIntent({ category_id: "no-existe", confidence: 0.9 }, valid)).toBeNull();
  });
  it("confianza fuera de rango → null", () => {
    expect(validateIntent({ category_id: "cat-precio", confidence: 2 }, valid)).toBeNull();
  });
  it("sin intención → null", () => {
    expect(validateIntent(null, valid)).toBeNull();
    expect(validateIntent(undefined, valid)).toBeNull();
  });
});

describe("condición de intención en el evaluador (F26)", () => {
  const ctx = (intent: RuleContext["intent"]): RuleContext => ({
    inbound: { text: "hola", is_known_button: false, length: 4, burst_count: 1 },
    contact: { temperature: null, tags: [], is_new: false, previous_episodes: 0 },
    conversation: { assigned: false, window_hours_left: 20, is_episode_start: true, channel: "instagram" },
    time: { in_business_hours: true },
    response: { text: "", has_link: false, parts: 1 },
    agent: { wants_escalate: false, kb_miss: false, used_tools: [] },
    intent,
  });
  const rule: Rule = { id: "ri", enabled: true, action: "send", conditions: [{ field: "intent.category", op: "is", value: { category_id: "cat-cuando", min_confidence: 0.8 } }] };

  it("coincide cuando la intención es la categoría con confianza suficiente", () => {
    expect(evaluateRules([rule], ctx({ category_id: "cat-cuando", confidence: 0.9 }), "after_generation", "draft").action).toBe("send");
  });
  it("no coincide con confianza baja", () => {
    expect(evaluateRules([rule], ctx({ category_id: "cat-cuando", confidence: 0.5 }), "after_generation", "draft").matched).toBe(false);
  });
  it("no coincide con otra categoría o sin intención", () => {
    expect(evaluateRules([rule], ctx({ category_id: "cat-precio", confidence: 0.9 }), "after_generation", "draft").matched).toBe(false);
    expect(evaluateRules([rule], ctx(null), "after_generation", "draft").matched).toBe(false);
  });
});
