"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { acceptLearnedRuleCore, discardLearnedRuleCore, retireLearnedRuleCore, type RuleDecision } from "@/lib/ai-learning/rules-run";
import { LEARNING_LIMITS, learningToJson, parseLearningSettings } from "@/lib/ai-learning/settings";
import type { Json } from "@/lib/types/database";
import { PERSON_TOOLS } from "@/lib/ai-tools/registry";

/**
 * Reglas aprendidas y ajustes de aprendizaje de un agente. Pide `agents.edit`. Escribe el
 * servidor con el cliente de servicio, filtrando por el workspace de la sesión.
 */

const NOT_ALLOWED = "No tenés permiso para configurar el agente.";

async function guard() {
  const ctx = await getPermissionAction("agents.edit");
  if (!ctx) return null;
  return { ctx, service: await createServiceClient() };
}

function revalidateAgent(agentId: string | null) {
  revalidatePath("/dashboard/agents");
  if (agentId) revalidatePath(`/dashboard/agents/${agentId}`);
}

async function agentOfRule(service: Awaited<ReturnType<typeof createServiceClient>>, workspaceId: string, ruleId: string): Promise<string | null> {
  const { data } = await service.from("agent_learned_rules").select("agent_id").eq("id", ruleId).eq("workspace_id", workspaceId).maybeSingle();
  return data?.agent_id ?? null;
}

export async function acceptLearnedRule(ruleId: string, text: string): Promise<RuleDecision> {
  const g = await guard();
  if (!g) return { ok: false, error: NOT_ALLOWED };
  const result = await acceptLearnedRuleCore(g.service, { workspaceId: g.ctx.workspace.id, ruleId, text, userId: g.ctx.user.id });
  revalidateAgent(await agentOfRule(g.service, g.ctx.workspace.id, ruleId));
  return result;
}

export async function discardLearnedRule(ruleId: string): Promise<RuleDecision> {
  const g = await guard();
  if (!g) return { ok: false, error: NOT_ALLOWED };
  const result = await discardLearnedRuleCore(g.service, { workspaceId: g.ctx.workspace.id, ruleId, userId: g.ctx.user.id });
  revalidateAgent(await agentOfRule(g.service, g.ctx.workspace.id, ruleId));
  return result;
}

export async function retireLearnedRule(ruleId: string): Promise<RuleDecision> {
  const g = await guard();
  if (!g) return { ok: false, error: NOT_ALLOWED };
  const result = await retireLearnedRuleCore(g.service, { workspaceId: g.ctx.workspace.id, ruleId, userId: g.ctx.user.id });
  revalidateAgent(await agentOfRule(g.service, g.ctx.workspace.id, ruleId));
  return result;
}

/**
 * Aprobación de acciones, ejemplos automáticos y umbral de reglas. Las acciones con aprobación y los ejemplos nacen
 * apagados (decisión de Wendy, 18/11/2026).
 */
export async function updateAgentLearning(
  agentId: string,
  input: { actionsNeedApproval: boolean; examples: boolean; approvedExamples: number; editExamples: number; ruleThreshold: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g) return { ok: false, error: NOT_ALLOWED };
  if (typeof input?.actionsNeedApproval !== "boolean" || typeof input.examples !== "boolean") return { ok: false, error: "Pedido inválido." };
  const inRange = (v: unknown, r: { min: number; max: number }) => Number.isInteger(v) && (v as number) >= r.min && (v as number) <= r.max;
  if (!inRange(input.approvedExamples, LEARNING_LIMITS.approvedExamples) || !inRange(input.editExamples, LEARNING_LIMITS.editExamples)) {
    return { ok: false, error: "Los ejemplos van de 0 a 10." };
  }
  if (!inRange(input.ruleThreshold, LEARNING_LIMITS.ruleThreshold)) return { ok: false, error: "El umbral va de 2 a 20 rechazos." };

  const { data: agent } = await g.service.from("agents").select("id, learning, actions_need_approval").eq("id", agentId).eq("workspace_id", g.ctx.workspace.id).is("deleted_at", null).maybeSingle();
  if (!agent) return { ok: false, error: "El agente no existe." };
  const before = parseLearningSettings(agent.learning);
  const next = { examples: input.examples, approvedExamples: input.approvedExamples, editExamples: input.editExamples, ruleThreshold: input.ruleThreshold };

  // Con la sesión de la persona: la RLS de agents (agents.edit) también decide.
  const { error } = await g.ctx.supabase
    .from("agents")
    .update({ learning: learningToJson(next) as Json, actions_need_approval: input.actionsNeedApproval })
    .eq("id", agentId);
  if (error) {
    console.error("[agents] no pude guardar el aprendizaje:", error.message);
    return { ok: false, error: "No pude guardar los cambios." };
  }
  await logAudit({
    supabase: g.ctx.supabase,
    workspaceId: g.ctx.workspace.id,
    entityType: "agent",
    entityId: agentId,
    action: "update",
    changes: {
      actions_need_approval: { old: agent.actions_need_approval, new: input.actionsNeedApproval },
      examples: { old: before.examples, new: input.examples },
      rule_threshold: { old: before.ruleThreshold, new: input.ruleThreshold },
    },
    metadata: { section: "learning" },
    performedBy: g.ctx.user.id,
  });
  revalidateAgent(agentId);
  return { ok: true };
}

/**
 * Las herramientas que ofrece el asistente del equipo. De serie, todas (decisión de Wendy, 18/11/2026). Se guardan en `agents.allowed_tools` del asistente. Pide `agents.edit`.
 */
export async function updateAssistantTools(agentId: string, keys: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g) return { ok: false, error: NOT_ALLOWED };
  if (!Array.isArray(keys)) return { ok: false, error: "Pedido inválido." };
  const known = new Set(PERSON_TOOLS.map((t) => t.key));
  const clean = [...new Set(keys.filter((k): k is string => typeof k === "string" && known.has(k)))];
  if (clean.length === 0) return { ok: false, error: "Dejá al menos una herramienta, o apagá el asistente." };
  const { data: agent } = await g.service.from("agents").select("id, type, allowed_tools").eq("id", agentId).eq("workspace_id", g.ctx.workspace.id).is("deleted_at", null).maybeSingle();
  if (!agent || agent.type !== "assistant") return { ok: false, error: "Ese agente no es el asistente." };
  const { error } = await g.ctx.supabase.from("agents").update({ allowed_tools: clean }).eq("id", agentId);
  if (error) {
    console.error("[agents] no pude guardar las herramientas del asistente:", error.message);
    return { ok: false, error: "No pude guardar las herramientas." };
  }
  await logAudit({
    supabase: g.ctx.supabase,
    workspaceId: g.ctx.workspace.id,
    entityType: "agent",
    entityId: agentId,
    action: "update",
    changes: { allowed_tools: { old: (agent.allowed_tools ?? []).join(", "), new: clean.join(", ") } },
    metadata: { section: "assistant_tools" },
    performedBy: g.ctx.user.id,
  });
  revalidateAgent(agentId);
  return { ok: true };
}
