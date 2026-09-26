import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";
import { validateRules, rulesDefaultSchema } from "./schema";
import type { RuleAction } from "./fields";

type Db = SupabaseClient<Database>;

export interface SaveRulesResult {
  ok: boolean;
  error?: string;
}

/**
 * Guarda las reglas de respuesta de un agente (F10). Lógica pura con el cliente
 * inyectado: la Server Action la envuelve con getAdminContext. Un Member no
 * llega acá (la acción lo corta antes con 403); el parámetro isAdmin es el
 * cinturón: si es false, rechaza.
 */
export async function saveResponseRules(args: {
  supabase: Db;
  workspaceId: string;
  agentId: string;
  userId: string;
  isAdmin: boolean;
  rules: unknown;
  previousRules: unknown;
}): Promise<SaveRulesResult> {
  if (!args.isAdmin) return { ok: false, error: "Solo Owner y Admin pueden editar las reglas" };

  const validated = validateRules(args.rules);
  if (!validated.ok) return { ok: false, error: validated.error };

  const { error } = await args.supabase
    .from("agents")
    .update({ response_rules: validated.rules as unknown as Json })
    .eq("id", args.agentId);
  if (error) {
    console.error("[rules] no pude guardar las reglas:", error.message);
    return { ok: false, error: "No pude guardar las reglas." };
  }

  await logAudit({
    supabase: args.supabase,
    workspaceId: args.workspaceId,
    entityType: "agent",
    entityId: args.agentId,
    action: "update",
    changes: { response_rules: { old: (args.previousRules ?? []) as Json, new: (validated.rules ?? []) as unknown as Json } },
    metadata: { section: "rules" },
    performedBy: args.userId,
  });
  return { ok: true };
}

/** Guarda la acción por defecto de las reglas (F10). */
export async function saveResponseRulesDefault(args: {
  supabase: Db;
  workspaceId: string;
  agentId: string;
  userId: string;
  isAdmin: boolean;
  action: unknown;
  previous: RuleAction;
}): Promise<SaveRulesResult> {
  if (!args.isAdmin) return { ok: false, error: "Solo Owner y Admin pueden editar las reglas" };
  const parsed = rulesDefaultSchema.safeParse(args.action);
  if (!parsed.success) return { ok: false, error: "Acción por defecto inválida" };

  const { error } = await args.supabase
    .from("agents")
    .update({ response_rules_default: parsed.data })
    .eq("id", args.agentId);
  if (error) {
    console.error("[rules] no pude guardar la acción por defecto:", error.message);
    return { ok: false, error: "No pude guardar la acción por defecto." };
  }

  await logAudit({
    supabase: args.supabase,
    workspaceId: args.workspaceId,
    entityType: "agent",
    entityId: args.agentId,
    action: "update",
    changes: { response_rules_default: { old: args.previous, new: parsed.data } },
    metadata: { section: "rules" },
    performedBy: args.userId,
  });
  return { ok: true };
}
