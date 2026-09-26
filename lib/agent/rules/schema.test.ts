import { describe, it, expect } from "vitest";
import { validateRules } from "./schema";
import { defaultRulesTemplate } from "./template";
import { unreachableRuleIds } from "./unreachable";
import type { Rule } from "./evaluate";

describe("validateRules (F10)", () => {
  it("acepta la plantilla completa", () => {
    const { rules } = defaultRulesTemplate();
    const r = validateRules(rules);
    expect(r.ok).toBe(true);
    expect(r.rules).toHaveLength(9);
  });

  const bad: Array<[string, unknown]> = [
    ["sin condiciones", [{ id: "a", enabled: true, action: "draft", conditions: [] }]],
    ["campo fuera de la lista", [{ id: "a", enabled: true, action: "draft", conditions: [{ field: "inbound.color", op: "is", value: true }] }]],
    ["operador inválido para el campo", [{ id: "a", enabled: true, action: "draft", conditions: [{ field: "inbound.length", op: "contains_any", value: ["x"] }] }]],
    ["lista de palabras vacía", [{ id: "a", enabled: true, action: "draft", conditions: [{ field: "inbound.text", op: "contains_any", value: [] }] }]],
    ["número fuera de rango", [{ id: "a", enabled: true, action: "draft", conditions: [{ field: "inbound.length", op: "gt", value: -5 }] }]],
    ["acción inválida", [{ id: "a", enabled: true, action: "explode", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] }]],
  ];

  for (const [label, rules] of bad) {
    it(`rechaza: ${label}`, () => {
      expect(validateRules(rules).ok).toBe(false);
    });
  }

  it("rechaza ids repetidos", () => {
    const rules = [
      { id: "dup", enabled: true, action: "draft", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] },
      { id: "dup", enabled: true, action: "skip", conditions: [{ field: "inbound.is_known_button", op: "is", value: false }] },
    ];
    expect(validateRules(rules).ok).toBe(false);
  });
});

describe("unreachableRuleIds (F10)", () => {
  it("marca una regla que repite una condición de una anterior más amplia", () => {
    const rules: Rule[] = [
      { id: "a", enabled: true, action: "skip", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] },
      { id: "b", enabled: true, action: "draft", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }, { field: "contact.temperature", op: "is", value: "hot" }] },
    ];
    expect(unreachableRuleIds(rules)).toContain("b");
  });

  it("no marca reglas independientes", () => {
    const rules: Rule[] = [
      { id: "a", enabled: true, action: "skip", conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] },
      { id: "b", enabled: true, action: "draft", conditions: [{ field: "contact.temperature", op: "is", value: "hot" }] },
    ];
    expect(unreachableRuleIds(rules)).toHaveLength(0);
  });
});
