/**
 * La pantalla de reglas (F57), en funciones puras: la lista de cada rol con su frase, su estado y el aviso
 * «nunca se usa», y las sugerencias de valores para el editor (los UTM que de verdad entraron).
 */
import { decodeUtm } from "@/lib/attribution/meta-match";
import { describeRule, isShadowed, ruleState, type DescribeLookups, type RuleState } from "./describe";
import { UTM_DIMENSIONS, type CommissionRole, type CommissionRule, type UtmDimension } from "./types";

export interface RuleView {
  id: string;
  name: string;
  role: string;
  position: number;
  state: RuleState;
  /** Una regla de arriba se queda con todos los pagos antes de que esta se mire. */
  shadowed: boolean;
  /** «Vendedor · Mentoría · 12 % del neto». */
  description: string;
  rule: CommissionRule;
}

/** Las reglas vivas (no archivadas) de cada rol, en orden de prioridad. Todos los roles aparecen, aunque no tengan reglas. */
export function buildRuleViews(
  roles: readonly CommissionRole[],
  rules: readonly CommissionRule[],
  lookups: DescribeLookups,
  todayLocal: string,
): Record<string, RuleView[]> {
  const out: Record<string, RuleView[]> = {};
  for (const role of roles) {
    const ordered = rules
      .filter((r) => r.role === role.key && !r.archived_at)
      .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
    out[role.key] = ordered.map((rule, index) => ({
      id: rule.id,
      name: rule.name,
      role: rule.role,
      position: rule.position,
      state: ruleState(rule, todayLocal),
      shadowed: isShadowed(rule, ordered.slice(0, index)),
      description: describeRule(rule, lookups),
      rule,
    }));
  }
  return out;
}

export interface TouchUtmRow {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content_label: string | null;
  term: string | null;
}

export type UtmSuggestions = Record<UtmDimension, string[]>;

const COLUMN: Record<UtmDimension, keyof TouchUtmRow> = { source: "source", medium: "medium", campaign: "campaign", content: "content_label", term: "term" };

/** Mismo criterio que el motor: decodificado, sin espacios de más y en minúsculas. */
const normalize = (value: string | null | undefined): string => (decodeUtm(value) ?? "").trim().toLowerCase();

/** Los valores más usados de cada dimensión (hasta `limit`), del más al menos frecuente. Un empate se ordena por nombre. */
export function utmSuggestions(touches: readonly TouchUtmRow[], limit = 20): UtmSuggestions {
  const out = {} as UtmSuggestions;
  for (const dim of UTM_DIMENSIONS) {
    const counts = new Map<string, number>();
    for (const touch of touches) {
      const value = normalize(touch[COLUMN[dim]]);
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    out[dim] = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([value]) => value);
  }
  return out;
}
