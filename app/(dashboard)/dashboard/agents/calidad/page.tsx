import { requirePermission } from "@/lib/auth/guards";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { loadWorkspaceAgents } from "@/lib/agent/config";
import { qualityTotals, qualityWeeks } from "@/lib/ai-learning/quality";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/ui/back-link";
import { QualityView } from "@/components/agents/quality/quality-view";

/**
 * Panel de calidad de la IA: por semana, la tasa de aprobación, la de edición y los motivos de rechazo. Lo
 * calcula `ai_quality_weekly` (00441) con la sesión de quien mira (la RLS de borradores y propuestas decide), sobre
 * el registro de desenlaces. Pide `agents.view`.
 */
export default async function QualityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("agents.view");
  const query = await searchParams;
  const [{ workspace, supabase }, service] = await Promise.all([getWorkspace(), createServiceClient()]);
  const agents = (await loadWorkspaceAgents(service, workspace.id)).map((a) => ({ id: a.id, name: a.name }));
  const agentParam = typeof query.agente === "string" ? query.agente : "";
  const agentId = agents.some((a) => a.id === agentParam) ? agentParam : null;
  const weeksParam = typeof query.semanas === "string" ? Number(query.semanas) : 8;
  const weeksCount = [4, 8, 12].includes(weeksParam) ? weeksParam : 8;

  const { data, error } = await supabase.rpc("ai_quality_weekly", { p_workspace_id: workspace.id, p_weeks: weeksCount, p_agent_id: agentId });
  if (error) console.error("[calidad] no pude leer la calidad semanal:", error.message);
  const weeks = qualityWeeks(data ?? []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader route="/dashboard/agents/calidad" backHref={<BackLink href="/dashboard/agents" label="Volver a Agentes IA" />} />
      <div className="flex-1 overflow-auto px-4 py-6 md:px-8">
        <QualityView weeks={weeks} totals={qualityTotals(weeks)} agents={agents} agentId={agentId} weeksCount={weeksCount} failed={Boolean(error)} />
      </div>
    </div>
  );
}
