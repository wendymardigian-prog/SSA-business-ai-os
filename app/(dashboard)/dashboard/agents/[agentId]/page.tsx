import { notFound } from "next/navigation";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { loadWorkspaceAgents } from "@/lib/agent/config";
import { getAgentType } from "@/lib/agent/agent-types";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { PROVIDERS } from "@/lib/integrations/providers";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { platformLabel } from "@/lib/platforms";
import { toScreenAgent, type AgentScreenData } from "@/lib/agent/screen";
import { AgentDetailView } from "@/components/agents/agent-detail-view";

/**
 * Detalle de un agente (F24 parcial, F26, F27, F30).
 *
 * Bloque 2a: pestanas Configuracion, Conocimiento y Canales. Herramientas,
 * Runs, Acciones y Costos quedan declaradas en el registro de tipos como
 * pendientes (Bloque 2b).
 */
export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agentId } = await params;
  const query = await searchParams;
  const { workspace, supabase } = await requireWorkspaceAdmin();
  const service = await createServiceClient();

  const agents = await loadWorkspaceAgents(service, workspace.id);
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) notFound();
  const typeDef = getAgentType(agent.type);
  if (!typeDef) notFound();

  const [versionsRes, providers, pricingRes, channelsRes, docsRes, triggersRes, members] = await Promise.all([
    supabase
      .from("agent_prompt_versions")
      .select("version, system_prompt, note, created_at, created_by")
      .eq("agent_id", agent.id)
      .order("version", { ascending: false }),
    listConnectedAiProviders(workspace.id, service),
    // model_pricing la leen Owner/Admin; con el cliente del usuario alcanza.
    supabase.from("model_pricing").select("provider, model").eq("workspace_id", workspace.id),
    supabase
      .from("channels")
      .select("id, platform, username, display_name, is_active")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("knowledge_base")
      .select("id, title, tags, internal_only, status")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null),
    supabase
      .from("triggers")
      .select("id, config, flows!inner(id, name, status, workspace_id)")
      .eq("type", "default")
      .eq("is_active", true)
      .eq("flows.status", "published")
      .eq("flows.workspace_id", workspace.id),
    getWorkspaceMembers(workspace.id),
  ]);

  const memberNames = new Map(members.map((m) => [m.userId, m.name]));
  const flowsCapturingAll = new Map<string, string>();
  for (const row of (triggersRes.data ?? []) as Array<{ config: unknown; flows: { id: string; name: string } | { id: string; name: string }[] }>) {
    const config = (row.config ?? {}) as Record<string, unknown>;
    if (config.only_if_agent_off === true) continue;
    const flow = Array.isArray(row.flows) ? row.flows[0] : row.flows;
    if (flow) flowsCapturingAll.set(flow.id, flow.name);
  }

  const data: AgentScreenData = {
    agent: toScreenAgent(agent),
    versions: (versionsRes.data ?? []).map((v) => ({
      version: v.version,
      systemPrompt: v.system_prompt,
      note: v.note,
      createdAt: v.created_at,
      authorLabel: v.created_by ? memberNames.get(v.created_by) ?? null : null,
    })),
    providers,
    providerLabels: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.label])),
    pricedModels: (pricingRes.data ?? []).map((p) => `${p.provider}/${p.model}`),
    channels: (channelsRes.data ?? []).map((c) => ({
      id: c.id,
      platform: c.platform,
      label: platformLabel(c.platform),
      handle: c.username ? `@${c.username}` : c.display_name ?? null,
      isActive: c.is_active,
      takenBy: agents.find((a) => a.id !== agent.id && a.enabledChannelIds.includes(c.id))?.name ?? null,
    })),
    knowledgeDocs: (docsRes.data ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      tags: d.tags ?? [],
      internalOnly: Boolean(d.internal_only),
      status: d.status,
    })),
    flowsCapturingAll: [...flowsCapturingAll].map(([id, name]) => ({ id, name })),
  };

  const requested = typeof query.tab === "string" ? query.tab : "config";
  const tab = typeDef.tabs.find((t) => t.key === requested && t.available)?.key ?? "config";

  return <AgentDetailView data={data} typeDef={typeDef} tab={tab} />;
}
