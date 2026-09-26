import { evaluateRules, type Rule, type RuleContext } from "./evaluate";
import type { RuleAction } from "./fields";

/**
 * Un caso histórico para simular (F11): el contexto reconstruido de un turno.
 * `hasResponse` distingue un turno que llegó a generar (evalúa etapa final) de
 * un entrante sin turno (sólo reglas previas). `realOutcome` es lo que pasó de
 * verdad con el borrador, para contrastar contra "se habría enviado directo".
 */
export interface SimulationCase {
  context: RuleContext;
  hasResponse: boolean;
  leadText: string;
  responseText: string | null;
  realOutcome: "approved_unchanged" | "corrected" | "discarded" | null;
}

export interface SimulationExample {
  leadText: string;
  responseText: string | null;
  ruleId: string | null;
}

export interface SimulationResult {
  totals: Record<RuleAction, number>;
  byRule: Record<string, number>;
  examples: Record<RuleAction, SimulationExample[]>;
  /** Contraste con la realidad para los que se habrían enviado directo. */
  wouldSendContrast: { approvedUnchanged: number; corrected: number; discarded: number; unknown: number };
}

const EXAMPLES_PER_ACTION = 10;

/**
 * Corre `evaluateRules` (la MISMA función del turno) sobre los casos, sin
 * llamar a ningún modelo ni escribir nada. Devuelve totales por acción,
 * coincidencias por regla, ejemplos y el contraste con la realidad.
 */
export function simulateRules(cases: SimulationCase[], rules: Rule[], defaultAction: RuleAction): SimulationResult {
  const totals: Record<RuleAction, number> = { send: 0, draft: 0, skip: 0 };
  const byRule: Record<string, number> = {};
  const examples: Record<RuleAction, SimulationExample[]> = { send: [], draft: [], skip: [] };
  const wouldSendContrast = { approvedUnchanged: 0, corrected: 0, discarded: 0, unknown: 0 };

  for (const c of cases) {
    // Un turno con respuesta evalúa la lista completa; un entrante sin turno
    // sólo puede activar reglas previas (las finales devuelven pending → default).
    const stage = c.hasResponse ? "after_generation" : "before_generation";
    let result = evaluateRules(rules, c.context, stage, defaultAction);
    if (result.action === "pending") {
      // Un entrante sin turno que corta en una regla final: cae al default.
      result = { action: defaultAction, ruleId: null, ruleIndex: null, matched: false, invalidRules: result.invalidRules };
    }
    const action = result.action as RuleAction;
    totals[action] += 1;
    if (result.ruleId) byRule[result.ruleId] = (byRule[result.ruleId] ?? 0) + 1;
    if (examples[action].length < EXAMPLES_PER_ACTION) {
      examples[action].push({ leadText: c.leadText, responseText: c.responseText, ruleId: result.ruleId });
    }
    if (action === "send") {
      switch (c.realOutcome) {
        case "approved_unchanged": wouldSendContrast.approvedUnchanged += 1; break;
        case "corrected": wouldSendContrast.corrected += 1; break;
        case "discarded": wouldSendContrast.discarded += 1; break;
        default: wouldSendContrast.unknown += 1; break;
      }
    }
  }

  return { totals, byRule, examples, wouldSendContrast };
}
