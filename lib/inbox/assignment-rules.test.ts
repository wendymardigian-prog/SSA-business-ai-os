import { describe, expect, it } from "vitest";
import cases from "./assignment-rules.cases.json";
import { checkRuleInput, pickRuleMember, simulateAssignment, type ConversationRule, type RuleMode } from "./assignment-rules";

describe("pickRuleMember (casos compartidos con conversation_rule_pick)", () => {
  it.each(cases)("$name", (c) => {
    expect(pickRuleMember(c.mode as RuleMode, c.members, c.active, c.last)).toBe(c.expected);
  });
});

function rule(partial: Partial<ConversationRule>): ConversationRule {
  return {
    id: partial.id ?? "r",
    name: "",
    position: 0,
    enabled: true,
    channelIds: [],
    mode: "fixed",
    memberIds: [],
    lastAssignedMemberId: null,
    setterMode: "none",
    archivedAt: null,
    ...partial,
  };
}

describe("simulateAssignment", () => {
  const ig1 = rule({ id: "ig1", position: 0, channelIds: ["ch-ig1"], memberIds: ["ana"] });
  const ig2 = rule({ id: "ig2", position: 1, channelIds: ["ch-ig2"], mode: "round_robin", memberIds: ["beto", "caro"], lastAssignedMemberId: "beto" });
  const all = rule({ id: "all", position: 2, channelIds: [], memberIds: ["dani"] });
  const active = ["ana", "beto", "caro", "dani"];

  it("cada cuenta va a su persona", () => {
    expect(simulateAssignment([ig1, ig2, all], "ch-ig1", active)?.userId).toBe("ana");
    expect(simulateAssignment([ig1, ig2, all], "ch-ig2", active)?.userId).toBe("caro");
  });

  it("una cuenta sin regla propia cae en la de todas las cuentas", () => {
    expect(simulateAssignment([ig1, ig2, all], "ch-wa", active)?.rule.id).toBe("all");
  });

  it("gana el orden, no el orden del arreglo", () => {
    const first = rule({ id: "first", position: -1, memberIds: ["dani"] });
    expect(simulateAssignment([ig1, first], "ch-ig1", active)?.rule.id).toBe("first");
  });

  it("una regla sin gente disponible deja pasar a la siguiente", () => {
    expect(simulateAssignment([ig1, all], "ch-ig1", ["dani"])?.userId).toBe("dani");
  });

  it("apagada o archivada no aplica", () => {
    expect(simulateAssignment([{ ...ig1, enabled: false }], "ch-ig1", active)).toBeNull();
    expect(simulateAssignment([{ ...ig1, archivedAt: "2026-10-23" }], "ch-ig1", active)).toBeNull();
  });
});

describe("checkRuleInput", () => {
  const known = { memberIds: ["ana", "beto"], channelIds: ["ch-1"] };

  it("acepta una regla válida y limpia repetidos", () => {
    const r = checkRuleInput({ name: " IG 1 ", mode: "round_robin", memberIds: ["ana", "beto", "ana"], channelIds: ["ch-1"], setterMode: "if_empty" }, known);
    expect(r).toEqual({ ok: true, value: { name: "IG 1", enabled: true, channelIds: ["ch-1"], mode: "round_robin", memberIds: ["ana", "beto"], setterMode: "if_empty" } });
  });

  it("rechaza gente o cuentas que no existen", () => {
    expect(checkRuleInput({ mode: "fixed", memberIds: ["zz"] }, known).ok).toBe(false);
    expect(checkRuleInput({ mode: "fixed", memberIds: ["ana"], channelIds: ["zz"] }, known).ok).toBe(false);
  });

  it("una fija va a una sola persona", () => {
    expect(checkRuleInput({ mode: "fixed", memberIds: ["ana", "beto"] }, known).ok).toBe(false);
  });

  it("sin personas o con un modo inventado, no", () => {
    expect(checkRuleInput({ mode: "fixed", memberIds: [] }, known).ok).toBe(false);
    expect(checkRuleInput({ mode: "random", memberIds: ["ana"] }, known).ok).toBe(false);
    expect(checkRuleInput({ mode: "fixed", memberIds: ["ana"], setterMode: "sometimes" }, known).ok).toBe(false);
  });
});
