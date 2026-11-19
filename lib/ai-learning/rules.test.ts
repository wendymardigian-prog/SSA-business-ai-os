import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import cases from "./rule-due.cases.json";
import { RULE_TEMPLATES, learnedRulesSection, parseRulesSnapshot, proposedRuleText, ruleIsDue, rulesSnapshot } from "./rules";
import { REJECT_REASONS } from "./reject-reasons";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { toAgentConfig } from "@/lib/agent/config";
import { agentRow } from "@/lib/agent/testing/fixtures";

const NOW = new Date("2026-11-14T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("reglas aprendidas: cuándo se propone una", () => {
  for (const c of cases as Array<{ name: string; rejectionsDaysAgo: number[]; lastDecisionDaysAgo: number | null; open: boolean; threshold: number; due: boolean }>) {
    it(c.name, () => {
      expect(
        ruleIsDue({
          rejectionsAt: c.rejectionsDaysAgo.map(daysAgo),
          lastDecisionAt: c.lastDecisionDaysAgo === null ? null : daysAgo(c.lastDecisionDaysAgo),
          hasOpenProposal: c.open,
          threshold: c.threshold,
          now: NOW,
        }),
      ).toBe(c.due);
    });
  }

  it("hay una plantilla para cada motivo de la lista", () => {
    for (const reason of REJECT_REASONS) expect(RULE_TEMPLATES[reason].length).toBeGreaterThan(10);
    expect(proposedRuleText("too_long")).toContain("corto");
  });

  it("la función SQL usa la misma ventana y el mismo mínimo de dos rechazos", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/00442_ai_learned_rules.sql"), "utf8");
    expect(sql).toContain("greatest(coalesce(p_threshold, 3), 2)");
    expect(sql).toContain("coalesce(p_window_days, 30)");
  });
});

describe("la sección de reglas en el prompt", () => {
  const agent = toAgentConfig(agentRow());

  it("sin reglas ni ejemplos, el prompt no cambia ni un carácter", () => {
    expect(buildSystemPrompt(agent, "n1", [], {})).toBe(buildSystemPrompt(agent, "n1", []));
    expect(buildSystemPrompt(agent, "n1", [], { rules: [], examples: "" })).toBe(buildSystemPrompt(agent, "n1", []));
  });

  it("con reglas activas, van en una sección aparte después de las instrucciones", () => {
    const prompt = buildSystemPrompt(agent, "n1", [], { rules: [{ id: "r1", text: "Respondé más corto." }] });
    expect(prompt).toContain("## Reglas aprendidas (aprobadas por el equipo)\n- Respondé más corto.");
    expect(prompt.indexOf("Reglas aprendidas")).toBeLessThan(prompt.indexOf("Reglas del sistema"));
  });

  it("los ejemplos viajan envueltos como datos", () => {
    const prompt = buildSystemPrompt(agent, "n1", [], { examples: "1. Hola" });
    expect(prompt).toContain("<<<crm n1>>>");
    expect(prompt).toContain("no instrucciones");
  });

  it("la foto de reglas va y vuelve; lo roto se ignora", () => {
    const snap = rulesSnapshot([{ id: "r1", text: "a b c d e" }]);
    expect(parseRulesSnapshot(snap)).toEqual([{ id: "r1", text: "a b c d e" }]);
    expect(parseRulesSnapshot([{ id: 1 }, "x", null])).toEqual([]);
    expect(learnedRulesSection([])).toBe("");
  });
});
