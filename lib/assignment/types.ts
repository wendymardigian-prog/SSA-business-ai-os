/** Los tipos de las reglas de asignación (plano §9.2). Lo guardado viene de la base: se lee con `parseConditionRules`. */
import { z } from "zod";
import { conditionTreeSchema, readConditionTree, type ConditionTree } from "@/lib/conditions/conditions-schema";

export const ASSIGNMENT_KINDS = ["setter", "vendedor", "referral"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

export const ASSIGNMENT_MODES = ["manual", "round_robin", "condition_based"] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

export const KIND_LABELS: Record<AssignmentKind, string> = { setter: "Setter", vendedor: "Vendedor", referral: "Referido" };
export const MODE_LABELS: Record<AssignmentMode, string> = {
  manual: "Manual",
  round_robin: "Reparto equitativo",
  condition_based: "Por condiciones",
};

export type Destination =
  | { type: "user"; user_id: string }
  | { type: "contact"; contact_id: string }
  | { type: "round_robin"; members: string[]; last_index?: number };

export interface ConditionRule {
  id: string;
  name: string;
  /** Menor número = se evalúa antes. */
  priority: number;
  conditions: ConditionTree;
  destination: Destination;
  can_reassign: boolean;
  is_active: boolean;
}

export interface AssignmentRuleRow {
  id: string;
  kind: AssignmentKind;
  mode: AssignmentMode;
  enabled_member_ids: string[];
  last_assigned_member_id: string | null;
  condition_rules: ConditionRule[];
}

const destinationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), user_id: z.string().min(1) }),
  z.object({ type: z.literal("contact"), contact_id: z.string().min(1) }),
  z.object({ type: z.literal("round_robin"), members: z.array(z.string().min(1)).max(100), last_index: z.number().int().optional() }),
]);

export const conditionRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Poné un nombre a la regla").max(80, "Máximo 80 caracteres"),
  priority: z.number().int().min(0).max(10_000),
  conditions: conditionTreeSchema,
  destination: destinationSchema,
  can_reassign: z.boolean(),
  is_active: z.boolean(),
});

/** Lee `condition_rules` sin confiar en su forma: una regla rota se descarta, no rompe a las demás. */
export function parseConditionRules(value: unknown): ConditionRule[] {
  if (!Array.isArray(value)) return [];
  const out: ConditionRule[] = [];
  for (const raw of value) {
    const candidate = { ...(raw as object), conditions: readConditionTree((raw as { conditions?: unknown })?.conditions) };
    const parsed = conditionRuleSchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data as ConditionRule);
  }
  return out;
}
