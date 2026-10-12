/**
 * Validar la configuración de las reglas de asignación (plano F13), antes de
 * guardar. La pantalla y la Server Action usan lo mismo; la base solo repite los
 * CHECK de forma.
 */
import { ASSIGNMENT_FIELD_KEYS } from "./context";
import { serializeConditionTree } from "@/lib/sales/conditions-schema";
import { isDestinationValid } from "./resolve";
import { conditionRuleSchema, type AssignmentKind, type AssignmentMode, type ConditionRule } from "./types";

export interface RuleConfigInput {
  kind: AssignmentKind;
  mode: AssignmentMode;
  enabledMemberIds: string[];
  conditionRules: unknown[];
}

export type RuleConfigCheck =
  | { ok: true; enabledMemberIds: string[]; conditionRules: ConditionRule[] }
  | { ok: false; error: string };

/** Dos reglas activas con la misma prioridad (empate): hay que resolverlo antes de guardar. */
export function priorityCollisions(rules: ReadonlyArray<Pick<ConditionRule, "id" | "priority" | "is_active" | "name">>): string[] {
  const seen = new Map<number, string>();
  const clashes: string[] = [];
  for (const rule of rules) {
    if (!rule.is_active) continue;
    const other = seen.get(rule.priority);
    if (other !== undefined) clashes.push(`«${other}» y «${rule.name}» tienen la misma prioridad (${rule.priority})`);
    else seen.set(rule.priority, rule.name);
  }
  return clashes;
}

export function checkRuleConfig(input: RuleConfigInput, workspaceMembers: ReadonlySet<string>): RuleConfigCheck {
  const enabled = [...new Set(input.enabledMemberIds)];
  if (enabled.some((id) => !workspaceMembers.has(id))) return { ok: false, error: "Hay una persona que ya no está en el workspace" };

  if (input.mode === "round_robin") {
    if (input.kind === "referral") return { ok: false, error: "El referido no se reparte por turnos: elegí una persona o un contacto" };
    if (enabled.length === 0) return { ok: false, error: "Elegí al menos una persona" };
  }

  const rules: ConditionRule[] = [];
  if (input.mode === "condition_based") {
    for (const raw of input.conditionRules) {
      const candidate = raw as { conditions?: unknown; destination?: unknown };
      const tree = serializeConditionTree(
        (candidate.conditions ?? { rootConjunction: "and", conditions: [], groups: [] }) as never,
        ASSIGNMENT_FIELD_KEYS,
      );
      const parsed = conditionRuleSchema.safeParse({ ...(raw as object), conditions: tree ?? { rootConjunction: "and", conditions: [], groups: [] } });
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Una regla no es válida" };
      const rule = parsed.data as ConditionRule;
      if (!tree) return { ok: false, error: `La regla «${rule.name}» necesita al menos una condición` };
      const dest = rule.destination;
      if (dest.type === "round_robin" && dest.members.length === 0) return { ok: false, error: `La regla «${rule.name}»: elegí al menos una persona para el reparto` };
      if (dest.type === "user" && !workspaceMembers.has(dest.user_id)) return { ok: false, error: `La regla «${rule.name}»: esa persona ya no está en el workspace` };
      if (!isDestinationValid(dest, input.kind, { members: workspaceMembers, contacts: new Set(dest.type === "contact" ? [dest.contact_id] : []) })) {
        return { ok: false, error: `La regla «${rule.name}» tiene un destino que no corresponde para ${input.kind === "referral" ? "un referido" : "este tipo"}` };
      }
      rules.push(rule);
    }
    const clashes = priorityCollisions(rules);
    if (clashes.length > 0) return { ok: false, error: clashes[0] };
  }

  return { ok: true, enabledMemberIds: enabled, conditionRules: rules };
}

/** Las reglas con un destino que ya no sirve (persona fuera del workspace, contacto borrado), para marcarlas "destino inválido". */
export function invalidDestinationIds(
  rules: readonly ConditionRule[],
  kind: AssignmentKind,
  validTargets: { members: ReadonlySet<string>; contacts: ReadonlySet<string> },
): string[] {
  return rules.filter((r) => !isDestinationValid(r.destination, kind, validTargets)).map((r) => r.id);
}
