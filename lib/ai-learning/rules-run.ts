import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";
import { createNotificationOnce } from "@/lib/notifications/create";
import { isRejectReason } from "./reject-reasons";
import { parseLearningSettings } from "./settings";
import { RULE_WINDOW_DAYS, parseRulesSnapshot, proposedRuleText, reasonLabel, rulesSnapshot, type LearnedRuleForPrompt } from "./rules";

/**
 * Reglas aprendidas en el servidor. Siempre con el cliente de servicio y DESPUÉS de comprobar el
 * permiso (`agents.edit` para decidir). Proponer nunca lanza: un rechazo no puede fallar porque no se pudo proponer
 * una regla.
 */

type Db = SupabaseClient<Database>;

/** Tras un rechazo: si se acumulan los del mismo motivo, deja una regla propuesta y avisa. Nunca lanza. */
export async function maybeProposeLearnedRule(service: Db, args: { workspaceId: string; agentId: string; reason: string }): Promise<string | null> {
  try {
    if (!isRejectReason(args.reason)) return null;
    const { data: agent } = await service.from("agents").select("id, name, learning").eq("id", args.agentId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!agent) return null;
    const learning = parseLearningSettings(agent.learning);
    const { data, error } = await service.rpc("propose_learned_rule_if_due", {
      p_workspace_id: args.workspaceId,
      p_agent_id: args.agentId,
      p_reason: args.reason,
      p_threshold: learning.ruleThreshold,
      p_window_days: RULE_WINDOW_DAYS,
      p_text: proposedRuleText(args.reason),
    });
    if (error) {
      console.error("[ai-learning] no pude proponer la regla:", error.message);
      return null;
    }
    const ruleId = typeof data === "string" ? data : null;
    if (!ruleId) return null;
    await logAudit({
      supabase: service,
      workspaceId: args.workspaceId,
      entityType: "agent",
      entityId: args.agentId,
      action: "ai_rule.proposed",
      metadata: { rule_id: ruleId, reason: args.reason },
      performedBy: null,
      actorType: "system",
      actorLabel: "Aprendizaje de la IA",
    });
    await createNotificationOnce({
      supabase: service,
      workspaceId: args.workspaceId,
      type: "ai_rule_proposed",
      title: `Regla propuesta para «${agent.name}»`,
      body: `Se repiten los rechazos por «${reasonLabel(args.reason)}». Revisá la regla propuesta: solo entra al prompt si la aceptás.`,
      metadata: { agent_id: args.agentId, rule_id: ruleId },
      withinMinutes: 60,
    });
    return ruleId;
  } catch (err) {
    console.error("[ai-learning] no pude proponer la regla:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Las reglas activas de un agente, en el orden en que se aceptaron. Nunca lanza (sin reglas ante un error). */
export async function loadActiveLearnedRules(service: Db, agentId: string): Promise<LearnedRuleForPrompt[]> {
  try {
    const { data, error } = await service
      .from("agent_learned_rules")
      .select("id, text")
      .eq("agent_id", agentId)
      .eq("status", "active")
      .order("decided_at", { ascending: true });
    if (error) return [];
    return (data ?? []).map((r) => ({ id: r.id, text: r.text }));
  } catch {
    return [];
  }
}

/** Crea una versión nueva del prompt con la foto de las reglas activas (el texto del prompt no cambia). */
async function snapshotVersion(service: Db, args: { workspaceId: string; agentId: string; userId: string; note: string }): Promise<number | null> {
  const { data: agent } = await service.from("agents").select("system_prompt, active_prompt_version").eq("id", args.agentId).maybeSingle();
  if (!agent) return null;
  const rules = await loadActiveLearnedRules(service, args.agentId);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: last } = await service.from("agent_prompt_versions").select("version").eq("agent_id", args.agentId).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = (last?.version ?? 0) + 1;
    const { error } = await service.from("agent_prompt_versions").insert({
      workspace_id: args.workspaceId,
      agent_id: args.agentId,
      version,
      system_prompt: agent.system_prompt ?? "",
      note: args.note.slice(0, 200),
      created_by: args.userId,
      learned_rules: rulesSnapshot(rules) as unknown as Json,
      change_kind: "learned_rules",
    });
    if (!error) {
      await service.from("agents").update({ active_prompt_version: version }).eq("id", args.agentId);
      return version;
    }
    if (error.code !== "23505") {
      console.error("[ai-learning] no pude guardar la versión:", error.message);
      return null;
    }
  }
  return null;
}

export type RuleDecision = { ok: true; version: number | null } | { ok: false; error: string };

export async function acceptLearnedRuleCore(service: Db, args: { workspaceId: string; ruleId: string; text: unknown; userId: string }): Promise<RuleDecision> {
  const text = typeof args.text === "string" ? args.text.trim() : "";
  if (text.length < 5 || text.length > 500) return { ok: false, error: "La regla tiene que tener entre 5 y 500 caracteres." };
  const now = new Date().toISOString();
  const { data } = await service
    .from("agent_learned_rules")
    .update({ status: "active", text, decided_by: args.userId, decided_at: now, updated_at: now })
    .eq("id", args.ruleId)
    .eq("workspace_id", args.workspaceId)
    .eq("status", "proposed")
    .select("id, agent_id, reason_key");
  const rule = data?.[0];
  if (!rule) return { ok: false, error: "Esa regla ya no está pendiente." };
  const version = await snapshotVersion(service, { workspaceId: args.workspaceId, agentId: rule.agent_id, userId: args.userId, note: `Regla aceptada: ${reasonLabel(rule.reason_key)}` });
  if (version) await service.from("agent_learned_rules").update({ version }).eq("id", rule.id);
  await logAudit({ supabase: service, workspaceId: args.workspaceId, entityType: "agent", entityId: rule.agent_id, action: "ai_rule.accepted", metadata: { rule_id: rule.id, reason: rule.reason_key, version }, performedBy: args.userId });
  return { ok: true, version };
}

export async function discardLearnedRuleCore(service: Db, args: { workspaceId: string; ruleId: string; userId: string }): Promise<RuleDecision> {
  const now = new Date().toISOString();
  const { data } = await service
    .from("agent_learned_rules")
    .update({ status: "discarded", decided_by: args.userId, decided_at: now, updated_at: now })
    .eq("id", args.ruleId)
    .eq("workspace_id", args.workspaceId)
    .eq("status", "proposed")
    .select("id, agent_id, reason_key");
  const rule = data?.[0];
  if (!rule) return { ok: false, error: "Esa regla ya no está pendiente." };
  await logAudit({ supabase: service, workspaceId: args.workspaceId, entityType: "agent", entityId: rule.agent_id, action: "ai_rule.discarded", metadata: { rule_id: rule.id, reason: rule.reason_key }, performedBy: args.userId });
  return { ok: true, version: null };
}

export async function retireLearnedRuleCore(service: Db, args: { workspaceId: string; ruleId: string; userId: string }): Promise<RuleDecision> {
  const now = new Date().toISOString();
  const { data } = await service
    .from("agent_learned_rules")
    .update({ status: "retired", decided_by: args.userId, decided_at: now, updated_at: now })
    .eq("id", args.ruleId)
    .eq("workspace_id", args.workspaceId)
    .eq("status", "active")
    .select("id, agent_id, reason_key");
  const rule = data?.[0];
  if (!rule) return { ok: false, error: "Esa regla ya no está activa." };
  const version = await snapshotVersion(service, { workspaceId: args.workspaceId, agentId: rule.agent_id, userId: args.userId, note: `Regla retirada: ${reasonLabel(rule.reason_key)}` });
  await logAudit({ supabase: service, workspaceId: args.workspaceId, entityType: "agent", entityId: rule.agent_id, action: "ai_rule.retired", metadata: { rule_id: rule.id, reason: rule.reason_key, version }, performedBy: args.userId });
  return { ok: true, version };
}

/**
 * Volver a una versión también vuelve a sus reglas: quedan activas las de la foto y se retiran las demás.
 * Nunca lanza; devuelve cuántas cambió.
 */
export async function restoreRulesFromVersion(service: Db, args: { agentId: string; snapshot: unknown; userId: string }): Promise<number> {
  try {
    const wanted = new Set(parseRulesSnapshot(args.snapshot).map((r) => r.id));
    const { data } = await service.from("agent_learned_rules").select("id, status").eq("agent_id", args.agentId).in("status", ["active", "retired"]);
    const now = new Date().toISOString();
    let changed = 0;
    for (const rule of data ?? []) {
      const next = wanted.has(rule.id) ? "active" : "retired";
      if (next === rule.status) continue;
      await service.from("agent_learned_rules").update({ status: next, decided_by: args.userId, decided_at: now, updated_at: now }).eq("id", rule.id);
      changed++;
    }
    return changed;
  } catch (err) {
    console.error("[ai-learning] no pude restaurar las reglas:", err instanceof Error ? err.message : String(err));
    return 0;
  }
}
