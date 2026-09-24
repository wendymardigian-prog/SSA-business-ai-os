import { notFound } from "next/navigation";
import { getWorkspace } from "@/lib/workspace";
import { isAdminRole, isOwnerRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/supabase/server";
import { loadWorkspaceAgents } from "@/lib/agent/config";
import { getAgentType, tabsForViewer } from "@/lib/agent/agent-types";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { PROVIDERS } from "@/lib/integrations/providers";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { platformLabel } from "@/lib/platforms";
import { toScreenAgent, type ActionsTabData, type AgentScreenData, type CostsTabData, type HeaderKpis, type RunsTabData } from "@/lib/agent/screen";
import { serializeToolsForScreen } from "@/lib/agent/tools/config";
import { loadRuns, parseRunFilters, RUNS_PAGE_SIZE } from "@/lib/agent/runs-query";
import { ACTIONS_PAGE_SIZE, loadActions, parseActionFilters } from "@/lib/agent/actions-query";
import { loadCostsTab, loadHeaderKpis, parseCostFilters } from "@/lib/agent/costs-query";
import { AgentDetailView } from "@/components/agents/agent-detail-view";

/**
 * Detalle de un agente (F24, F26, F27, F28, F30).
 *
 * Owner/Admin ven todas las pestanas. Un Member entra solo a Runs y Acciones,
 * acotadas a su scope por la RLS y sin columnas de costo: la configuracion y
 * los topes de gasto se leen con service role pero no se le mandan.
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
  const { workspace, supabase, role } = await getWorkspace();
  const isAdmin = isAdminRole(role);
  const service = await createServiceClient();

  const agents = await loadWorkspaceAgents(service, workspace.id);
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) notFound();
  const typeDef = getAgentType(agent.type);
  if (!typeDef) notFound();

  const { tabs, defaultTab } = tabsForViewer(typeDef, isAdmin);
  const requested = typeof query.tab === "string" ? query.tab : defaultTab;
  const tab = tabs.find((t) => t.key === requested && t.available)?.key ?? defaultTab;

  const [versionsRes, providers, pricingRes, channelsRes, docsRes, triggersRes, members, tagsRes] = await Promise.all([
    isAdmin
      ? supabase
          .from("agent_prompt_versions")
          .select("version, system_prompt, note, created_at, created_by")
          .eq("agent_id", agent.id)
          .order("version", { ascending: false })
      : Promise.resolve({ data: [] }),
    isAdmin ? listConnectedAiProviders(workspace.id, service) : Promise.resolve([]),
    // model_pricing la leen Owner/Admin; con el cliente del usuario alcanza.
    isAdmin ? supabase.from("model_pricing").select("provider, model").eq("workspace_id", workspace.id) : Promise.resolve({ data: [] }),
    supabase
      .from("channels")
      .select("id, platform, username, display_name, is_active")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: true }),
    isAdmin
      ? supabase.from("knowledge_base").select("id, title, tags, internal_only, status").eq("workspace_id", workspace.id).is("deleted_at", null)
      : Promise.resolve({ data: [] }),
    isAdmin
      ? supabase
          .from("triggers")
          .select("id, config, flows!inner(id, name, status, workspace_id)")
          .eq("type", "default")
          .eq("is_active", true)
          .eq("flows.status", "published")
          .eq("flows.workspace_id", workspace.id)
      : Promise.resolve({ data: [] }),
    getWorkspaceMembers(workspace.id),
    supabase.from("tags").select("id, name").eq("workspace_id", workspace.id).order("name"),
  ]);

  const memberNames = new Map(members.map((m) => [m.userId, m.name]));
  const flowsCapturingAll = new Map<string, string>();
  for (const row of (triggersRes.data ?? []) as Array<{ config: unknown; flows: { id: string; name: string } | { id: string; name: string }[] }>) {
    const config = (row.config ?? {}) as Record<string, unknown>;
    if (config.only_if_agent_off === true) continue;
    const flow = Array.isArray(row.flows) ? row.flows[0] : row.flows;
    if (flow) flowsCapturingAll.set(flow.id, flow.name);
  }

  const channels = (channelsRes.data ?? []).map((c) => ({
    id: c.id,
    platform: c.platform,
    label: platformLabel(c.platform),
    handle: c.username ? `@${c.username}` : c.display_name ?? null,
    isActive: c.is_active,
    takenBy: agents.find((a) => a.id !== agent.id && a.enabledChannelIds.includes(c.id))?.name ?? null,
  }));
  const pricedModels = ((pricingRes.data ?? []) as Array<{ provider: string; model: string }>).map((p) => `${p.provider}/${p.model}`);
  const screenAgent = toScreenAgent(agent);
  if (!isAdmin) {
    // Los topes de gasto no salen del servidor para un Member (00060).
    screenAgent.dailyCostLimitUsd = null;
    screenAgent.monthlyCostLimitUsd = null;
    screenAgent.systemPrompt = "";
    screenAgent.toolsConfig = {};
  }

  let runs: RunsTabData | undefined;
  if (tab === "runs") {
    const tools = serializeToolsForScreen().map((t) => ({ name: t.name, label: t.label }));
    const models = [...new Set([agent.model, agent.fallbackModel, ...pricedModels.map((p) => p.split("/")[1])].filter((m): m is string => Boolean(m)))].sort();
    const filters = parseRunFilters(query, {
      currentAgentId: agent.id,
      agentIds: agents.map((a) => a.id),
      channelIds: channels.map((c) => c.id),
      toolNames: tools.map((t) => t.name),
      models,
      allowCost: isAdmin,
    });
    const channelLabel = (c: (typeof channels)[number]) => (c.handle ? `${c.label} ${c.handle}` : c.label);
    // Admin: service role, con costos. Member: su cliente, RLS = scope, sin costos.
    const client = isAdmin ? service : supabase;
    const [{ rows, total }, anyRes] = await Promise.all([
      loadRuns(client, {
        workspaceId: workspace.id,
        filters,
        includeCost: isAdmin,
        agentNames: new Map(agents.map((a) => [a.id, a.name])),
        channelLabels: new Map(channels.map((c) => [c.id, channelLabel(c)])),
      }),
      client.from("agent_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    ]);
    runs = {
      filters,
      rows,
      total,
      pageSize: RUNS_PAGE_SIZE,
      anyRuns: (anyRes.count ?? 0) > 0,
      options: {
        agents: agents.map((a) => ({ id: a.id, name: a.name })),
        channels: channels.map((c) => ({ id: c.id, label: channelLabel(c) })),
        models,
        tools,
      },
      showCost: isAdmin,
    };
  }

  let actions: ActionsTabData | undefined;
  if (tab === "actions") {
    const channelLabel = (c: (typeof channels)[number]) => (c.handle ? `${c.label} ${c.handle}` : c.label);
    const filters = parseActionFilters(query, {
      currentAgentId: agent.id,
      agentIds: agents.map((a) => a.id),
      channelIds: channels.map((c) => c.id),
    });
    // Siempre con el cliente del usuario: la policy de la 00068 acota a un
    // Member a las acciones sobre sus leads; un Admin ve todas.
    const [{ rows, total }, anyRes] = await Promise.all([
      loadActions(supabase, {
        workspaceId: workspace.id,
        filters,
        agentNames: new Map(agents.map((a) => [a.id, a.name])),
        channelLabels: new Map(channels.map((c) => [c.id, channelLabel(c)])),
        tagNames: new Map((tagsRes.data ?? []).map((t) => [t.id, t.name])),
        memberNames,
      }),
      supabase.from("audit_log").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).not("performed_by_agent_id", "is", null),
    ]);
    actions = {
      filters,
      rows,
      total,
      pageSize: ACTIONS_PAGE_SIZE,
      anyActions: (anyRes.count ?? 0) > 0,
      options: { agents: agents.map((a) => ({ id: a.id, name: a.name })), channels: channels.map((c) => ({ id: c.id, label: channelLabel(c) })) },
    };
  }

  // Costos y los indicadores de la cabecera: solo Owner/Admin, con service role.
  let costs: CostsTabData | undefined;
  let kpis: HeaderKpis | undefined;
  if (isAdmin) {
    const workspaceLimits = {
      daily: workspace.ai_daily_cost_limit_usd === null || workspace.ai_daily_cost_limit_usd === undefined ? null : Number(workspace.ai_daily_cost_limit_usd),
      monthly: workspace.ai_monthly_cost_limit_usd === null || workspace.ai_monthly_cost_limit_usd === undefined ? null : Number(workspace.ai_monthly_cost_limit_usd),
    };
    [kpis, costs] = await Promise.all([
      loadHeaderKpis(service, { workspaceId: workspace.id, agentId: agent.id }),
      tab === "costs"
        ? loadCostsTab(service, {
            workspaceId: workspace.id,
            agent,
            filters: parseCostFilters(query),
            agentNames: new Map(agents.map((a) => [a.id, a.name])),
            workspaceLimits,
            canEditPricing: isOwnerRole(role),
          })
        : Promise.resolve(undefined),
    ]);
  }

  const data: AgentScreenData = {
    viewer: { isAdmin },
    kpis,
    costs,
    runs,
    actions,
    agent: screenAgent,
    tools: serializeToolsForScreen(),
    toolOptionSources: {
      tags: (tagsRes.data ?? []).map((t) => ({ value: t.id, label: t.name })),
      members: members.map((m) => ({ value: m.userId, label: m.name, hint: m.role })),
      contact_fields: [],
    },
    versions: ((versionsRes.data ?? []) as Array<{ version: number; system_prompt: string; note: string | null; created_at: string; created_by: string | null }>).map((v) => ({
      version: v.version,
      systemPrompt: v.system_prompt,
      note: v.note,
      createdAt: v.created_at,
      authorLabel: v.created_by ? memberNames.get(v.created_by) ?? null : null,
    })),
    providers,
    providerLabels: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.label])),
    pricedModels,
    channels,
    knowledgeDocs: ((docsRes.data ?? []) as Array<{ id: string; title: string; tags: string[] | null; internal_only: boolean | null; status: string }>).map((d) => ({
      id: d.id,
      title: d.title,
      tags: d.tags ?? [],
      internalOnly: Boolean(d.internal_only),
      status: d.status,
    })),
    flowsCapturingAll: [...flowsCapturingAll].map(([id, name]) => ({ id, name })),
    persistZernioInbound: workspace.persist_zernio_inbound !== false,
  };

  return <AgentDetailView data={data} typeDef={typeDef} tab={tab} />;
}
