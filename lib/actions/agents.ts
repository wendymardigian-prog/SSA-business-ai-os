"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext, isOwnerRole } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit, diffFields } from "@/lib/audit";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { loadAgentById, loadWorkspaceAgents } from "@/lib/agent/config";
import { getAgentType } from "@/lib/agent/agent-types";
import { validateAgentConfig, validateSystemPrompt } from "@/lib/agent/validate";
import { normalizeToolsConfig } from "@/lib/agent/tools/config";
import { agentUsableTagIds } from "@/lib/tags/effects";
import type { Json } from "@/lib/types/database";

/**
 * Gestion de los agentes de IA (F24 parcial, F26, F27, F30).
 *
 * Solo Owner/Admin. La regla vive en la RLS de agents (00060) y se repite aca
 * para devolver un mensaje claro. Todo cambio de configuracion queda en el
 * audit_log (entity "agent").
 *
 * Lectura con service role: las columnas de topes de gasto no son legibles
 * para el rol authenticated, ni siquiera para un Admin (se leen del servidor
 * detras de este guard). Escritura con el cliente del usuario, asi la RLS
 * sigue siendo quien decide.
 */

const AGENTS_PATH = "/dashboard/agents";

export type AgentActionResult = { ok: true; agentId?: string } | { ok: false; error: string };

const NOT_ADMIN = "Solo Owner y Admin pueden configurar el agente.";

function revalidate(agentId?: string) {
  revalidatePath(AGENTS_PATH);
  if (agentId) revalidatePath(`${AGENTS_PATH}/${agentId}`);
  revalidatePath("/dashboard/inbox");
}

async function loadOwnAgent(workspaceId: string, agentId: string) {
  if (typeof agentId !== "string" || !agentId) return null;
  const service = await createServiceClient();
  const agent = await loadAgentById(service, agentId);
  return agent && agent.workspaceId === workspaceId ? agent : null;
}

/** Crea el agente de conversacion con los defaults, apagado y sin canales. */
export async function createDefaultAgent(): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;

  const service = await createServiceClient();
  const existing = (await loadWorkspaceAgents(service, workspace.id)).find((a) => getAgentType(a.type)?.conversational);
  if (existing) return { ok: true, agentId: existing.id };

  // Arranca con el primer proveedor de texto conectado, si hay. Si no hay,
  // queda sin modelo y la pantalla lo pide.
  const providers = await listConnectedAiProviders(workspace.id, service);
  const first = providers[0];

  const { data, error } = await supabase
    .from("agents")
    .insert({
      workspace_id: workspace.id,
      name: "Asistente de conversacion",
      type: "chat",
      is_enabled: false,
      system_prompt: DEFAULT_AGENT_SYSTEM_PROMPT,
      active_prompt_version: 1,
      provider: first?.provider ?? null,
      model: first?.defaultModel || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[agents] no pude crear el agente:", error?.message);
    return { ok: false, error: "No pude crear el agente. Proba de nuevo." };
  }

  const { error: versionError } = await supabase.from("agent_prompt_versions").insert({
    workspace_id: workspace.id,
    agent_id: data.id,
    version: 1,
    system_prompt: DEFAULT_AGENT_SYSTEM_PROMPT,
    note: "Prompt inicial",
    created_by: user.id,
  });
  if (versionError) console.error("[agents] no pude guardar la version inicial:", versionError.message);

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "agent",
    entityId: data.id,
    action: "create",
    metadata: { type: "chat" },
    performedBy: user.id,
  });

  revalidate(data.id);
  return { ok: true, agentId: data.id };
}

/** Configuracion general: modelo, tiempos, formato, guardarrailes, topes. */
export async function updateAgentConfig(agentId: string, input: unknown): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;

  const agent = await loadOwnAgent(workspace.id, agentId);
  if (!agent) return { ok: false, error: "El agente no existe." };

  const validated = validateAgentConfig(input);
  if (!validated.ok) return validated;
  const v = validated.value;

  // Solo se puede ELEGIR un proveedor conectado. Si ya estaba configurado y
  // dejo de estar disponible, se puede guardar el resto sin cambiarlo: la
  // pantalla lo muestra en rojo, nunca lo reemplaza en silencio.
  const service = await createServiceClient();
  const connected = new Set((await listConnectedAiProviders(workspace.id, service)).map((p) => p.provider));
  if (v.provider && v.provider !== agent.provider && !connected.has(v.provider)) {
    return { ok: false, error: "Ese proveedor no esta conectado. Se conecta en Integraciones." };
  }
  if (v.fallbackProvider && v.fallbackProvider !== agent.fallbackProvider && !connected.has(v.fallbackProvider)) {
    return { ok: false, error: "El proveedor de respaldo no esta conectado." };
  }

  const update = {
    name: v.name,
    provider: v.provider,
    model: v.model,
    fallback_provider: v.fallbackProvider,
    fallback_model: v.fallbackModel,
    temperature: v.temperature,
    max_output_tokens: v.maxOutputTokens,
    model_timeout_seconds: v.modelTimeoutSeconds,
    bundle_window_seconds: v.bundleWindowSeconds,
    response_delay_seconds: v.responseDelaySeconds,
    max_wait_seconds: v.maxWaitSeconds,
    external_reply_cooldown_minutes: v.externalReplyCooldownMinutes,
    max_replies_per_conversation: v.maxRepliesPerConversation,
    burst_max_age_hours: v.burstMaxAgeHours,
    close_after_inactive_hours: v.closeAfterInactiveHours,
    summary_on_close: v.summaryOnClose,
    classify_on_close: v.classifyOnClose,
    output_format: v.outputFormat as unknown as Json,
    guardrails: v.guardrails as unknown as Json,
    daily_cost_limit_usd: v.dailyCostLimitUsd,
    daily_cost_limit_action: v.dailyCostLimitAction,
    monthly_cost_limit_usd: v.monthlyCostLimitUsd,
    monthly_cost_limit_action: v.monthlyCostLimitAction,
  };

  const { error } = await supabase.from("agents").update(update).eq("id", agent.id).eq("workspace_id", workspace.id);
  if (error) {
    console.error("[agents] no pude guardar la configuracion:", error.message);
    return { ok: false, error: describeDbError(error.message) };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "agent",
    entityId: agent.id,
    action: "update",
    changes: diffFields(
      flatten({
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        fallback_provider: agent.fallbackProvider,
        fallback_model: agent.fallbackModel,
        temperature: agent.temperature,
        max_output_tokens: agent.maxOutputTokens,
        model_timeout_seconds: agent.modelTimeoutSeconds,
        bundle_window_seconds: agent.bundleWindowSeconds,
        response_delay_seconds: agent.responseDelaySeconds,
        max_wait_seconds: agent.maxWaitSeconds,
        external_reply_cooldown_minutes: agent.externalReplyCooldownMinutes,
        max_replies_per_conversation: agent.maxRepliesPerConversation,
        burst_max_age_hours: agent.burstMaxAgeHours,
        close_after_inactive_hours: agent.closeAfterInactiveHours,
        summary_on_close: agent.summaryOnClose,
        classify_on_close: agent.classifyOnClose,
        output_format: agent.outputFormat,
        guardrails: agent.guardrails,
        daily_cost_limit_usd: agent.dailyCostLimitUsd,
        daily_cost_limit_action: agent.dailyCostLimitAction,
        monthly_cost_limit_usd: agent.monthlyCostLimitUsd,
        monthly_cost_limit_action: agent.monthlyCostLimitAction,
      }),
      flatten(update),
    ),
    metadata: { section: "config" },
    performedBy: user.id,
  });

  revalidate(agent.id);
  return { ok: true, agentId: agent.id };
}

/** Los jsonb se comparan como texto: diffFields compara valores planos. */
function flatten(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v]),
  );
}

function describeDbError(message: string): string {
  if (message.includes("agents_time_budget")) return "La demora mas el timeout no entran en el tiempo maximo de un turno.";
  if (message.includes("agents_windows_range")) return "Revisa la ventana de silencio, el tope de espera y el tope de respuestas.";
  if (message.includes("agents_burst_max_age_range")) return "La antiguedad maxima de la rafaga va de 1 a 720 horas.";
  if (message.includes("agents_close_after_range")) return "Las horas de inactividad para cerrar van de 1 a 720.";
  return "No se pudieron guardar los cambios. Proba de nuevo.";
}

/** Guardar el prompt crea una version nueva (F26). */
export async function saveSystemPrompt(agentId: string, rawPrompt: string, rawNote?: string): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;

  const agent = await loadOwnAgent(workspace.id, agentId);
  if (!agent) return { ok: false, error: "El agente no existe." };

  const prompt = validateSystemPrompt(rawPrompt);
  if (!prompt.ok) return prompt;
  if (prompt.value === agent.systemPrompt.trim()) return { ok: false, error: "El prompt no cambio." };

  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 200) || null : null;

  const { data: last } = await supabase
    .from("agent_prompt_versions")
    .select("version")
    .eq("agent_id", agent.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (last?.version ?? 0) + 1;

  const { error: versionError } = await supabase.from("agent_prompt_versions").insert({
    workspace_id: workspace.id,
    agent_id: agent.id,
    version,
    system_prompt: prompt.value,
    note,
    created_by: user.id,
  });
  if (versionError) {
    console.error("[agents] no pude guardar la version del prompt:", versionError.message);
    return {
      ok: false,
      error: versionError.code === "23505" ? "Otra persona guardo el prompt al mismo tiempo. Recarga y proba de nuevo." : "No pude guardar el prompt.",
    };
  }

  const { error } = await supabase
    .from("agents")
    .update({ system_prompt: prompt.value, active_prompt_version: version })
    .eq("id", agent.id);
  if (error) {
    console.error("[agents] no pude activar la version del prompt:", error.message);
    return { ok: false, error: "Se guardo la version pero no pude activarla. Proba volver a ella desde el historial." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "agent",
    entityId: agent.id,
    action: "prompt_version",
    changes: { active_prompt_version: { old: agent.promptVersion, new: version } },
    metadata: { note, chars: prompt.value.length },
    performedBy: user.id,
  });

  revalidate(agent.id);
  return { ok: true, agentId: agent.id };
}

/** Volver a una version anterior: la version activa pasa a ser esa, sin reescribir el historial. */
export async function restorePromptVersion(agentId: string, version: number): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;

  const agent = await loadOwnAgent(workspace.id, agentId);
  if (!agent) return { ok: false, error: "El agente no existe." };
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: "Version invalida." };

  const { data: target } = await supabase
    .from("agent_prompt_versions")
    .select("version, system_prompt")
    .eq("agent_id", agent.id)
    .eq("version", version)
    .maybeSingle();
  if (!target) return { ok: false, error: "Esa version no existe." };

  const { error } = await supabase
    .from("agents")
    .update({ system_prompt: target.system_prompt, active_prompt_version: target.version })
    .eq("id", agent.id);
  if (error) {
    console.error("[agents] no pude restaurar la version:", error.message);
    return { ok: false, error: "No pude volver a esa version." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "agent",
    entityId: agent.id,
    action: "prompt_version",
    changes: { active_prompt_version: { old: agent.promptVersion, new: target.version } },
    metadata: { restored: true },
    performedBy: user.id,
  });

  revalidate(agent.id);
  return { ok: true, agentId: agent.id };
}

/** Encendido global. Para encender hace falta un modelo con proveedor conectado. */
export async function setAgentEnabled(agentId: string, enabled: boolean): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;
  if (typeof enabled !== "boolean") return { ok: false, error: "Pedido invalido." };

  const agent = await loadOwnAgent(workspace.id, agentId);
  if (!agent) return { ok: false, error: "El agente no existe." };

  if (enabled) {
    if (!agent.provider || !agent.model) return { ok: false, error: "Antes de encenderlo, elegi el proveedor y el modelo." };
    const service = await createServiceClient();
    const connected = (await listConnectedAiProviders(workspace.id, service)).some((p) => p.provider === agent.provider);
    if (!connected) return { ok: false, error: "El proveedor configurado no esta conectado. Conectalo en Integraciones o elegi otro." };
  }

  const { error } = await supabase.from("agents").update({ is_enabled: enabled }).eq("id", agent.id);
  if (error) {
    console.error("[agents] no pude cambiar el encendido:", error.message);
    return { ok: false, error: "No pude cambiar el encendido del agente." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "agent",
    entityId: agent.id,
    action: "update",
    changes: { is_enabled: { old: agent.isEnabled, new: enabled } },
    performedBy: user.id,
  });

  revalidate(agent.id);
  return { ok: true, agentId: agent.id };
}

/** Acceso a la base de conocimiento (F27). */
export async function updateAgentKnowledge(
  agentId: string,
  input: { enabled: boolean; tags: string[]; fallback: "escalate" | "general" },
): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;

  const agent = await loadOwnAgent(workspace.id, agentId);
  if (!agent) return { ok: false, error: "El agente no existe." };

  if (
    typeof input?.enabled !== "boolean" ||
    !Array.isArray(input.tags) ||
    !["escalate", "general"].includes(input.fallback)
  ) {
    return { ok: false, error: "Pedido invalido." };
  }

  // Solo tags que existen en la base de conocimiento del workspace.
  const { data: docs } = await supabase
    .from("knowledge_base")
    .select("tags")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);
  const existing = new Set((docs ?? []).flatMap((d) => d.tags ?? []));
  const tags = [...new Set(input.tags.filter((t): t is string => typeof t === "string"))];
  const unknown = tags.filter((t) => !existing.has(t));
  if (unknown.length > 0) return { ok: false, error: `No hay documentos con la etiqueta "${unknown[0]}".` };

  const { error } = await supabase
    .from("agents")
    .update({ knowledge_enabled: input.enabled, knowledge_tags: tags, knowledge_fallback: input.fallback })
    .eq("id", agent.id);
  if (error) {
    console.error("[agents] no pude guardar el acceso a la KB:", error.message);
    return { ok: false, error: "No pude guardar el acceso a la base de conocimiento." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "agent",
    entityId: agent.id,
    action: "update",
    changes: diffFields(
      { knowledge_enabled: agent.knowledgeEnabled, knowledge_tags: agent.knowledgeTags.join(", "), knowledge_fallback: agent.knowledgeFallback },
      { knowledge_enabled: input.enabled, knowledge_tags: tags.join(", "), knowledge_fallback: input.fallback },
    ),
    metadata: { section: "knowledge" },
    performedBy: user.id,
  });

  revalidate(agent.id);
  return { ok: true, agentId: agent.id };
}

/**
 * Interruptor maestro por canal (F30). Sin FK en enabled_channel_ids: se valida
 * aca que el canal exista, sea del workspace y no lo atienda otro agente.
 */
export async function setAgentChannel(agentId: string, channelId: string, enabled: boolean): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;
  if (typeof channelId !== "string" || typeof enabled !== "boolean") return { ok: false, error: "Pedido invalido." };

  const agent = await loadOwnAgent(workspace.id, agentId);
  if (!agent) return { ok: false, error: "El agente no existe." };

  const { data: channel } = await supabase
    .from("channels")
    .select("id")
    .eq("id", channelId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!channel) return { ok: false, error: "Ese canal no existe en este workspace." };

  if (enabled) {
    const service = await createServiceClient();
    const other = (await loadWorkspaceAgents(service, workspace.id)).find(
      (a) => a.id !== agent.id && a.enabledChannelIds.includes(channelId),
    );
    if (other) return { ok: false, error: `Ese canal ya lo atiende "${other.name}". Un canal tiene un solo agente.` };
  }

  // Tambien se limpian ids huerfanos de canales que ya no existen.
  const { data: channels } = await supabase.from("channels").select("id").eq("workspace_id", workspace.id);
  const valid = new Set((channels ?? []).map((c) => c.id));
  const next = new Set(agent.enabledChannelIds.filter((id) => valid.has(id)));
  if (enabled) next.add(channelId);
  else next.delete(channelId);

  // El modo por canal (00070) solo vale para los canales encendidos: al apagar
  // uno se borra su entrada, asi no queda una segunda fuente de verdad que
  // reaparezca el dia que se vuelva a prender.
  const modes = Object.fromEntries(Object.entries(agent.channelModes).filter(([id]) => next.has(id)));

  const { error } = await supabase
    .from("agents")
    .update({ enabled_channel_ids: [...next], channel_modes: modes as Json })
    .eq("id", agent.id);
  if (error) {
    console.error("[agents] no pude cambiar los canales:", error.message);
    return { ok: false, error: "No pude cambiar el canal." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "agent",
    entityId: agent.id,
    action: "update",
    changes: { enabled_channel_ids: { old: agent.enabledChannelIds.join(", "), new: [...next].join(", ") } },
    metadata: { section: "channels", channel_id: channelId },
    performedBy: user.id,
  });

  revalidate(agent.id);
  return { ok: true, agentId: agent.id };
}

/**
 * Modo de entrega de un canal (Bloque 2c): "send" envia directo, "draft" deja
 * borradores para que una persona los apruebe. Solo para canales que el agente
 * atiende: el modo de un canal apagado no significa nada.
 */
export async function setAgentChannelMode(
  agentId: string,
  channelId: string,
  mode: "send" | "draft" | "rules",
): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;
  if (typeof channelId !== "string" || (mode !== "send" && mode !== "draft" && mode !== "rules")) {
    return { ok: false, error: "Pedido invalido." };
  }

  const agent = await loadOwnAgent(workspace.id, agentId);
  if (!agent) return { ok: false, error: "El agente no existe." };
  if (!agent.enabledChannelIds.includes(channelId)) {
    return { ok: false, error: "Primero encendé el agente en ese canal." };
  }

  const stored = agent.channelModes[channelId];
  const previous = stored === "draft" || stored === "rules" ? stored : "send";
  if (previous === mode) return { ok: true, agentId: agent.id };

  // "send" es la ausencia de entrada; "draft"/"rules" se guardan como clave.
  const modes: Record<string, "draft" | "rules"> = { ...agent.channelModes } as Record<string, "draft" | "rules">;
  if (mode === "send") delete modes[channelId];
  else modes[channelId] = mode;

  const { error } = await supabase.from("agents").update({ channel_modes: modes as Json }).eq("id", agent.id);
  if (error) {
    console.error("[agents] no pude cambiar el modo del canal:", error.message);
    return { ok: false, error: "No pude cambiar el modo del canal." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "agent",
    entityId: agent.id,
    action: "update",
    changes: { channel_mode: { old: previous, new: mode } },
    metadata: { section: "channels", channel_id: channelId },
    performedBy: user.id,
  });

  revalidate(agent.id);
  revalidatePath("/dashboard/drafts");
  return { ok: true, agentId: agent.id };
}

/**
 * Herramientas del agente y sus parametros (F23). Cada configuracion se valida
 * contra el configSchema de su herramienta en el registro, y lo que apunta a
 * la base (tags, miembros) se recorta a lo que existe.
 */
export async function updateAgentTools(
  agentId: string,
  input: { allowedTools: unknown; toolsConfig: unknown },
): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;

  const agent = await loadOwnAgent(workspace.id, agentId);
  if (!agent) return { ok: false, error: "El agente no existe." };

  const [{ data: tags }, { data: members }] = await Promise.all([
    supabase.from("tags").select("id, disables_agent, assigns_to").eq("workspace_id", workspace.id),
    supabase.from("workspace_members").select("user_id").eq("workspace_id", workspace.id),
  ]);
  const normalized = normalizeToolsConfig(input, {
    // Las etiquetas con efecto (00073) no entran en la lista del agente.
    existingTagIds: agentUsableTagIds((tags ?? []).map((t) => ({ id: t.id, disablesAgent: t.disables_agent, assignsTo: t.assigns_to }))),
    memberIds: (members ?? []).map((m) => m.user_id),
  });
  if (!normalized.ok) return normalized;

  const { error } = await supabase
    .from("agents")
    .update({ allowed_tools: normalized.allowedTools, tools_config: normalized.toolsConfig as Json })
    .eq("id", agent.id);
  if (error) {
    console.error("[agents] no pude guardar las herramientas:", error.message);
    return { ok: false, error: "No pude guardar las herramientas." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "agent",
    entityId: agent.id,
    action: "update",
    changes: diffFields(
      { allowed_tools: [...agent.allowedTools].sort().join(", "), tools_config: JSON.stringify(agent.toolsConfig) },
      { allowed_tools: [...normalized.allowedTools].sort().join(", "), tools_config: JSON.stringify(normalized.toolsConfig) },
    ),
    metadata: { section: "tools" },
    performedBy: user.id,
  });

  revalidate(agent.id);
  return { ok: true, agentId: agent.id };
}

/** Topes globales de gasto de IA del workspace (F29). Owner/Admin. */
export async function updateWorkspaceAiLimits(input: { dailyUsd: number | null; monthlyUsd: number | null }): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;

  const valid = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1_000_000);
  if (!valid(input?.dailyUsd) || !valid(input?.monthlyUsd)) return { ok: false, error: "Los topes tienen que ser numeros positivos (o vacios)." };

  const { error } = await supabase
    .from("workspaces")
    .update({ ai_daily_cost_limit_usd: input.dailyUsd, ai_monthly_cost_limit_usd: input.monthlyUsd })
    .eq("id", workspace.id);
  if (error) {
    console.error("[agents] no pude guardar los topes del workspace:", error.message);
    return { ok: false, error: "No pude guardar los topes del workspace." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    changes: diffFields(
      { ai_daily_cost_limit_usd: workspace.ai_daily_cost_limit_usd, ai_monthly_cost_limit_usd: workspace.ai_monthly_cost_limit_usd },
      { ai_daily_cost_limit_usd: input.dailyUsd, ai_monthly_cost_limit_usd: input.monthlyUsd },
    ),
    metadata: { section: "ai_limits" },
    performedBy: user.id,
  });

  revalidate();
  return { ok: true };
}

/**
 * Precio nuevo para un modelo (F29). Solo Owner (la RLS de model_pricing lo
 * exige; aca se repite para el mensaje). Nunca se pisa un precio: es una fila
 * nueva con valid_from ahora, y los runs viejos conservan el que tenian.
 */
export async function addModelPrice(input: {
  provider: string;
  model: string;
  inputPerMtok: number;
  outputPerMtok: number;
  cachedInputPerMtok: number;
  note?: string | null;
}): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  if (!isOwnerRole(ctx.role)) return { ok: false, error: "Solo el Owner puede cambiar la tabla de precios." };
  const { workspace, supabase, user } = ctx;

  const provider = typeof input?.provider === "string" ? input.provider.trim().toLowerCase() : "";
  const model = typeof input?.model === "string" ? input.model.trim() : "";
  const price = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10_000;
  if (!/^[a-z0-9_-]{2,40}$/.test(provider)) return { ok: false, error: "Proveedor invalido (ej: anthropic, openai, google, voyage)." };
  if (!model || model.length > 120) return { ok: false, error: "Indica el modelo." };
  if (!price(input.inputPerMtok) || !price(input.outputPerMtok) || !price(input.cachedInputPerMtok)) {
    return { ok: false, error: "Los precios son USD por millon de tokens, numeros positivos." };
  }
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) || null : null;

  const { data, error } = await supabase
    .from("model_pricing")
    .insert({
      workspace_id: workspace.id,
      provider,
      model,
      input_per_mtok: input.inputPerMtok,
      output_per_mtok: input.outputPerMtok,
      cached_input_per_mtok: input.cachedInputPerMtok,
      note,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[agents] no pude guardar el precio:", error?.message);
    return { ok: false, error: error?.code === "23505" ? "Ya hay un precio para ese modelo en este instante. Proba en un momento." : "No pude guardar el precio." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    metadata: { section: "model_pricing", pricing_id: data.id, provider, model, input_per_mtok: input.inputPerMtok, output_per_mtok: input.outputPerMtok, cached_input_per_mtok: input.cachedInputPerMtok },
    performedBy: user.id,
  });

  revalidate();
  return { ok: true };
}

/**
 * Guarda las reglas de respuesta del agente (F10). Owner/Admin. La lógica y la
 * validación viven en lib/agent/rules/save.ts para poder testearlas sin sesión.
 */
export async function saveResponseRulesAction(agentId: string, rules: unknown): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;

  const agent = await loadOwnAgent(workspace.id, agentId);
  if (!agent) return { ok: false, error: "El agente no existe." };

  const { saveResponseRules } = await import("@/lib/agent/rules/save");
  const result = await saveResponseRules({
    supabase,
    workspaceId: workspace.id,
    agentId: agent.id,
    userId: user.id,
    isAdmin: true,
    rules,
    previousRules: agent.responseRules,
  });
  if (!result.ok) return { ok: false, error: result.error ?? "No pude guardar las reglas." };

  revalidate(agent.id);
  return { ok: true, agentId: agent.id };
}

/** Guarda la acción por defecto de las reglas (F10). Owner/Admin. */
export async function setResponseRulesDefaultAction(agentId: string, action: unknown): Promise<AgentActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;

  const agent = await loadOwnAgent(workspace.id, agentId);
  if (!agent) return { ok: false, error: "El agente no existe." };

  const { saveResponseRulesDefault } = await import("@/lib/agent/rules/save");
  const result = await saveResponseRulesDefault({
    supabase,
    workspaceId: workspace.id,
    agentId: agent.id,
    userId: user.id,
    isAdmin: true,
    action,
    previous: agent.responseRulesDefault,
  });
  if (!result.ok) return { ok: false, error: result.error ?? "No pude guardar." };

  revalidate(agent.id);
  return { ok: true, agentId: agent.id };
}

/**
 * Simula las reglas sobre los turnos de los últimos 30 días (F11). Sólo lectura:
 * no llama a ningún modelo ni escribe nada. Owner/Admin.
 */
export async function simulateResponseRulesAction(
  agentId: string,
  rules: unknown,
  defaultAction: unknown,
): Promise<
  | { ok: true; result: import("@/lib/agent/rules/simulate").SimulationResult; sampled: number }
  | { ok: false; error: string }
> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase } = ctx;

  const agent = await loadOwnAgent(workspace.id, agentId);
  if (!agent) return { ok: false, error: "El agente no existe." };

  const { validateRules, rulesDefaultSchema } = await import("@/lib/agent/rules/schema");
  const validated = validateRules(rules);
  if (!validated.ok) return { ok: false, error: validated.error ?? "Reglas inválidas" };
  const def = rulesDefaultSchema.safeParse(defaultAction);
  if (!def.success) return { ok: false, error: "Acción por defecto inválida" };

  const { loadSimulationCases } = await import("@/lib/agent/rules/simulate-load");
  const { simulateRules } = await import("@/lib/agent/rules/simulate");
  const cases = await loadSimulationCases(supabase, workspace.id);
  const result = simulateRules(cases, validated.rules ?? [], def.data);
  return { ok: true, result, sampled: cases.length };
}
