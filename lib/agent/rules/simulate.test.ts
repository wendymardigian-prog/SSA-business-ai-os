import { describe, it, expect } from "vitest";
import { simulateRules, type SimulationCase } from "./simulate";
import type { Rule, RuleContext } from "./evaluate";

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

const rules: Rule[] = [
  { id: "r1", enabled: true, action: "skip", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] },
  { id: "r3", enabled: true, action: "draft", conditions: [{ field: "response.text", op: "contains_any", value: ["precio"] }] },
  { id: "r9", enabled: true, action: "send", conditions: [{ field: "inbound.length", op: "lt", value: 25 }, { field: "response.has_link", op: "is", value: false }] },
];

// 12 turnos (con respuesta) + 8 entrantes sin turno, con valores calculados a mano.
function buildCases(): SimulationCase[] {
  const cases: SimulationCase[] = [];
  // 4 turnos con "precio" → draft (r3)
  for (let i = 0; i < 4; i++) {
    cases.push({ context: ctx({ inbound: { text: "cuanto sale", is_known_button: false, length: 11, burst_count: 1 }, response: { text: "el precio es 500", has_link: false, parts: 1 } }), hasResponse: true, leadText: "cuanto sale", responseText: "el precio es 500", realOutcome: null });
  }
  // 5 turnos cortos sin link → send (r9). Contraste real: 3 aprobados, 1 corregido, 1 descartado.
  const outcomes: SimulationCase["realOutcome"][] = ["approved_unchanged", "approved_unchanged", "approved_unchanged", "corrected", "discarded"];
  for (let i = 0; i < 5; i++) {
    cases.push({ context: ctx({ inbound: { text: "ok", is_known_button: false, length: 2, burst_count: 1 }, response: { text: "listo", has_link: false, parts: 1 } }), hasResponse: true, leadText: "ok", responseText: "listo", realOutcome: outcomes[i] });
  }
  // 3 turnos largos sin regla que coincida → default (draft)
  for (let i = 0; i < 3; i++) {
    cases.push({ context: ctx({ inbound: { text: "x".repeat(40), is_known_button: false, length: 40, burst_count: 1 }, response: { text: "una respuesta larga", has_link: false, parts: 1 } }), hasResponse: true, leadText: "larga", responseText: "una respuesta larga", realOutcome: null });
  }
  // 8 entrantes sin turno: 6 botones (skip r1) + 2 texto libre (default draft)
  for (let i = 0; i < 6; i++) {
    cases.push({ context: ctx({ inbound: { text: "si enviamelo", is_known_button: true, length: 12, burst_count: 1 }, response: undefined }), hasResponse: false, leadText: "si enviamelo", responseText: null, realOutcome: null });
  }
  for (let i = 0; i < 2; i++) {
    cases.push({ context: ctx({ inbound: { text: "una consulta", is_known_button: false, length: 12, burst_count: 1 }, response: undefined }), hasResponse: false, leadText: "una consulta", responseText: null, realOutcome: null });
  }
  return cases;
}

describe("simulateRules (F11)", () => {
  const result = simulateRules(buildCases(), rules, "draft");

  it("totales por acción exactos", () => {
    // send: 5 (cortos). draft: 4 (precio) + 3 (largos default) + 2 (entrantes default) = 9. skip: 6 (botones).
    expect(result.totals).toEqual({ send: 5, draft: 9, skip: 6 });
  });

  it("coincidencias por regla", () => {
    expect(result.byRule.r1).toBe(6);
    expect(result.byRule.r3).toBe(4);
    expect(result.byRule.r9).toBe(5);
  });

  it("contraste con la realidad de los que se habrían enviado directo", () => {
    expect(result.wouldSendContrast).toEqual({ approvedUnchanged: 3, corrected: 1, discarded: 1, unknown: 0 });
  });

  it("hasta 10 ejemplos por acción", () => {
    expect(result.examples.skip.length).toBeLessThanOrEqual(10);
    expect(result.examples.draft.length).toBeGreaterThan(0);
  });
});
