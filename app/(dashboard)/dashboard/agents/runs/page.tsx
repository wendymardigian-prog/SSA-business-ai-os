import { getWorkspace } from "@/lib/workspace";
import { getPermissionContext } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/supabase/server";
import { RUNS_PAGE_SIZE, loadRuns } from "@/lib/agent/runs-query";
import { loadRunsScreenInputs } from "@/lib/agent/runs-screen-data";
import { PageHeader } from "@/components/page-header";
import { AiPeriodControl } from "@/components/agents/ai-dashboard/period-control";
import { RunsScreen } from "@/components/agents/runs-screen";

/**
 * Corridas (Bloque R, R1): todas las corridas de IA del workspace, de
 * cualquier agente y cualquier origen. Reemplaza a la pestaña Runs del
 * agente (D8), que ahora es esta misma vista con `?agente={id}`.
 *
 * Abierta a cualquier Member: la RLS (00060) ya le deja ver solo las
 * corridas de sus conversaciones, y las columnas de costo nunca se piden sin
 * `ai_costs.view` (D7) — ni siquiera a un Owner con el cliente del usuario.
 */
export default async function AgentRunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, role, supabase } = await getWorkspace();
  const isAdmin = isAdminRole(role);
  const service = await createServiceClient();
  const permissions = await getPermissionContext();
  const includeCost = permissions.can("ai_costs.view");
  const timeZone = (workspace as { timezone?: string }).timezone || "America/Costa_Rica";

  const sp = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") urlParams.set(k, v);

  const { filters, dateRange, client, agents, channels, options } = await loadRunsScreenInputs({
    workspaceId: workspace.id,
    timeZone,
    service,
    userClient: supabase,
    includeCost,
    searchParams: urlParams,
    rawParams: sp,
  });

  const { rows, total } = await loadRuns(client, {
    workspaceId: workspace.id,
    filters,
    includeCost,
    agentNames: new Map(agents.map((a) => [a.id, a.name])),
    channelLabels: new Map(channels.map((c) => [c.id, c.label])),
    dateRange,
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/agents/runs" filters={<AiPeriodControl timezone={timeZone} />} />
      <div className="flex-1 overflow-auto px-4 py-6 md:px-8">
        <RunsScreen rows={rows} total={total} pageSize={RUNS_PAGE_SIZE} filters={filters} showCost={includeCost} isAdmin={isAdmin} options={options} />
      </div>
    </div>
  );
}
