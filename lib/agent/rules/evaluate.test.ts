import { describe, it, expect } from "vitest";
import { evaluateRules, type Rule, type RuleContext } from "./evaluate";
import { defaultRulesTemplate } from "./template";

function ctx(over: Partial<RuleContext> = {}): RuleContext {
  return {
    inbound: { text: "hola", is_known_button: false, length: 4, burst_count: 1 },
    contact: { temperature: null, tags: [], is_new: false, previous_episodes: 0 },
    conversation: { assigned: false, window_hours_left: 20, is_episode_start: true, channel: "instagram" },
    time: { in_business_hours: true },
    response: { text: "", has_link: false, parts: 1 },
    agent: { wants_escalate: false, kb_miss: false, used_tools: [] },
    intent: null,
    ...over,
  };
}

const rule = (over: Partial<Rule>): Rule => ({ id: "r", enabled: true, conditions: [], action: "draft", ...over });

describe("evaluateRules — operadores y campos (F8)", () => {
  it("contains_any normaliza los dos lados (PRECIOO coincide con precio)", () => {
    const rules = [rule({ id: "r1", action: "draft", conditions: [{ field: "response.text", op: "contains_any", value: ["precio"] }] })];
    const r = evaluateRules(rules, ctx({ response: { text: "El PRECIOO es 500", has_link: false, parts: 1 } }), "after_generation", "send");
    expect(r).toMatchObject({ action: "draft", ruleId: "r1", matched: true });
  });

  it("is_known_button", () => {
    const rules = [rule({ id: "b", action: "skip", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] })];
    expect(evaluateRules(rules, ctx({ inbound: { text: "si enviamelo", is_known_button: true, length: 12, burst_count: 1 } }), "before_generation", "draft").action).toBe("skip");
    expect(evaluateRules(rules, ctx(), "before_generation", "draft").action).toBe("draft");
  });

  it("gt/lt numéricos", () => {
    const long = [rule({ id: "L", conditions: [{ field: "inbound.length", op: "gt", value: 200 }] })];
    expect(evaluateRules(long, ctx({ inbound: { text: "x", is_known_button: false, length: 250, burst_count: 1 } }), "before_generation", "send").matched).toBe(true);
    expect(evaluateRules(long, ctx({ inbound: { text: "x", is_known_button: false, length: 10, burst_count: 1 } }), "before_generation", "send").matched).toBe(false);
  });

  it("has_any / has_none con etiquetas", () => {
    const r = [rule({ id: "t", conditions: [{ field: "contact.tags", op: "has_any", value: ["alumno-actual"] }] })];
    expect(evaluateRules(r, ctx({ contact: { temperature: null, tags: ["alumno-actual"], is_new: false, previous_episodes: 1 } }), "before_generation", "send").matched).toBe(true);
  });

  it("temperature is/is_not", () => {
    const r = [rule({ id: "h", conditions: [{ field: "contact.temperature", op: "is", value: "hot" }] })];
    expect(evaluateRules(r, ctx({ contact: { temperature: "hot", tags: [], is_new: false, previous_episodes: 0 } }), "before_generation", "send").matched).toBe(true);
  });

  it("agent.used_tool es contains en la lista de herramientas", () => {
    const r = [rule({ id: "u", conditions: [{ field: "agent.used_tool", op: "is", value: "buscar_conocimiento" }] })];
    expect(evaluateRules(r, ctx({ agent: { wants_escalate: false, kb_miss: false, used_tools: ["buscar_conocimiento"] } }), "after_generation", "send").matched).toBe(true);
  });
});

describe("evaluateRules — orden, default, pausadas, inválidas", () => {
  it("gana la primera que coincide", () => {
    const rules = [
      rule({ id: "a", action: "skip", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] }),
      rule({ id: "b", action: "draft", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] }),
    ];
    expect(evaluateRules(rules, ctx({ inbound: { text: "x", is_known_button: true, length: 1, burst_count: 1 } }), "before_generation", "send").ruleId).toBe("a");
  });

  it("ninguna coincide → default", () => {
    expect(evaluateRules([], ctx(), "after_generation", "skip").action).toBe("skip");
  });

  it("una regla pausada no se evalúa", () => {
    const rules = [rule({ id: "off", enabled: false, action: "skip", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] })];
    expect(evaluateRules(rules, ctx({ inbound: { text: "x", is_known_button: true, length: 1, burst_count: 1 } }), "before_generation", "draft").action).toBe("draft");
  });

  it("una regla con campo desconocido se saltea y se reporta", () => {
    const rules = [rule({ id: "bad", conditions: [{ field: "inbound.color", op: "is", value: "rojo" }] })];
    const r = evaluateRules(rules, ctx(), "before_generation", "send");
    expect(r.invalidRules).toContain("bad");
    expect(r.matched).toBe(false);
  });

  it("un operador inválido para el campo se saltea", () => {
    const rules = [rule({ id: "bad2", conditions: [{ field: "inbound.length", op: "contains_any", value: ["x"] }] })];
    expect(evaluateRules(rules, ctx(), "before_generation", "send").invalidRules).toContain("bad2");
  });
});

describe("evaluateRules — corte en dos etapas (F8)", () => {
  it("before_generation corta en la primera regla que mira la respuesta", () => {
    const rules = [
      rule({ id: "final-first", action: "draft", conditions: [{ field: "response.text", op: "contains_any", value: ["precio"] }] }),
      rule({ id: "pre-later", action: "skip", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] }),
    ];
    const r = evaluateRules(rules, ctx({ inbound: { text: "x", is_known_button: true, length: 1, burst_count: 1 } }), "before_generation", "send");
    expect(r.action).toBe("pending");
  });

  it("dos etapas dan el mismo resultado que la lista completa (≥10 casos)", () => {
    const { rules, defaultAction } = defaultRulesTemplate();
    const cases: RuleContext[] = [
      ctx({ inbound: { text: "si enviamelo", is_known_button: true, length: 12, burst_count: 1 } }),
      ctx({ inbound: { text: "gracias por ponerte en contacto", is_known_button: false, length: 30, burst_count: 1 } }),
      ctx({ response: { text: "el precio es 500", has_link: false, parts: 1 } }),
      ctx({ agent: { wants_escalate: true, kb_miss: false, used_tools: [] } }),
      ctx({ agent: { wants_escalate: false, kb_miss: true, used_tools: [] } }),
      ctx({ contact: { temperature: "hot", tags: [], is_new: false, previous_episodes: 0 } }),
      ctx({ contact: { temperature: null, tags: ["alumno-actual"], is_new: false, previous_episodes: 3 } }),
      ctx({ inbound: { text: "x".repeat(250), is_known_button: false, length: 250, burst_count: 1 } }),
      ctx({ inbound: { text: "ok", is_known_button: false, length: 2, burst_count: 1 }, response: { text: "listo", has_link: false, parts: 1 } }),
      ctx({ response: { text: "mira este link https://x.com", has_link: true, parts: 1 } }),
      ctx(),
      ctx({ inbound: { text: "hola", is_known_button: false, length: 4, burst_count: 3 } }),
    ];
    for (const c of cases) {
      const full = evaluateRules(rules, c, "after_generation", defaultAction);
      const pre = evaluateRules(rules, c, "before_generation", defaultAction);
      const combined = pre.action === "pending" ? evaluateRules(rules, c, "after_generation", defaultAction) : pre;
      expect(combined.action).toBe(full.action);
      expect(combined.ruleId).toBe(full.ruleId);
    }
  });
});
