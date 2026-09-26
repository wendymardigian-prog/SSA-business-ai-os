import type { Rule } from "./evaluate";

/**
 * Avisa (sin bloquear) cuando una regla nunca puede coincidir porque una
 * anterior cubre lo mismo (F10). Heurística conservadora: sólo marca el caso
 * claro — una regla anterior con un subconjunto de las MISMAS condiciones
 * (mismo field/op/value), habilitada. No intenta razonar rangos numéricos.
 */
export function unreachableRuleIds(rules: Rule[]): string[] {
  const unreachable: string[] = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule.enabled) continue;
    for (let j = 0; j < i; j++) {
      const earlier = rules[j];
      if (!earlier.enabled) continue;
      // La anterior es más amplia si TODAS sus condiciones están (iguales) en
      // la actual: cualquier caso que active la actual ya activó la anterior.
      if (earlier.conditions.every((ec) => rule.conditions.some((rc) => sameCondition(ec, rc)))) {
        unreachable.push(rule.id);
        break;
      }
    }
  }
  return unreachable;
}

function sameCondition(a: { field: string; op: string; value: unknown }, b: { field: string; op: string; value: unknown }): boolean {
  return a.field === b.field && a.op === b.op && JSON.stringify(a.value) === JSON.stringify(b.value);
}
