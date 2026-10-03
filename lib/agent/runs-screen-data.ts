import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { loadWorkspaceAgents } from "./config";
import { serializeToolsForScreen } from "./tools/config";
import { ruleFilterOptions } from "./runs-filters";
import { AGENT_FILTER_ALL, loadActiveSources, parseRunFilters } from "./runs-query";
import { resolvePeriod } from "@/lib/dashboards/period";
import { parsePeriodFilter } from "./ai-dashboard/url-state";
import type { RunFilters, RunsScreenOptions } from "./screen";

type Db = SupabaseClient<Database>;

/**
 * Lo que necesitan tanto la pantalla de Corridas como el export a CSV (R1,
 * R3): un solo lugar para no mantener dos copias de "como se arman los
 * filtros y las opciones".
 */
export async function loadRunsScreenInputs(args: {
  workspaceId: string;
  timeZone: string;
  service: Db;
  userClient: Db;
  includeCost: boolean;
  searchParams: URLSearchParams;
  rawParams: Record<string, string | string[] | undefined>;
}): Promise<{
  filters: RunFilters;
  dateRange: { from: string | null; to: string | null };
  client: Db;
  agents: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; label: string }>;
  options: RunsScreenOptions;
}> {
  const client = args.includeCost ? args.service : args.userClient;

  const periodFilter = parsePeriodFilter(args.searchParams);
  const dateRange =
    periodFilter.from && periodFilter.to
      ? { from: periodFilter.from, to: periodFilter.to }
      : resolvePeriod(periodFilter.period, new Date(), args.timeZone);

  const [agentConfigs, channelsRes, sources] = await Promise.all([
    loadWorkspaceAgents(args.service, args.workspaceId),
    args.userClient.from("channels").select("id, platform, username, display_name").eq("workspace_id", args.workspaceId),
    loadActiveSources(client, { workspaceId: args.workspaceId, dateRange }),
  ]);

  const channelsRaw = (channelsRes.data ?? []) as Array<{ id: string; platform: string; username: string | null; display_name: string | null }>;
  const channelLabel = (c: (typeof channelsRaw)[number]) => c.display_name ?? (c.username ? `@${c.username}` : c.platform);
  const channels = channelsRaw.map((c) => ({ id: c.id, label: channelLabel(c) }));

  const tools = serializeToolsForScreen().map((t) => ({ name: t.name, label: t.label }));
  const pricing = args.includeCost
    ? (await args.service.from("model_pricing").select("provider, model").eq("workspace_id", args.workspaceId)).data ?? []
    : [];
  const models = [
    ...new Set([...agentConfigs.flatMap((a) => [a.model, a.fallbackModel]), ...pricing.map((p) => p.model)].filter((m): m is string => Boolean(m))),
  ].sort();

  const agenteRaw = typeof args.rawParams.agente === "string" ? args.rawParams.agente : AGENT_FILTER_ALL;
  const selectedAgent = agentConfigs.find((a) => a.id === agenteRaw);
  const ruleList = selectedAgent ? selectedAgent.responseRules.map((r) => ({ id: r.id, name: r.name ?? null })) : [];

  const agents = agentConfigs.map((a) => ({ id: a.id, name: a.name }));

  const filters = parseRunFilters(args.rawParams, {
    currentAgentId: null,
    agentIds: agents.map((a) => a.id),
    channelIds: channels.map((c) => c.id),
    toolNames: tools.map((t) => t.name),
    models,
    allowCost: args.includeCost,
    ruleIds: ruleList.map((r) => r.id),
    sources,
  });

  return {
    filters,
    dateRange,
    client,
    agents,
    channels,
    options: { agents, channels, models, tools, sources, rules: ruleFilterOptions(ruleList) },
  };
}
