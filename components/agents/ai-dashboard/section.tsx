import { createServiceClient } from "@/lib/supabase/server";
import { loadAiDashboardData, loadRunCounts24h } from "@/lib/agent/ai-dashboard/data";
import { buildAiKpiCards } from "@/lib/agent/ai-dashboard/kpis";
import { computeSystemStatus } from "@/lib/agent/ai-dashboard/system-status";
import { loadIntegrations } from "@/lib/integrations/load";
import { periodFilterToParams, type PeriodFilter } from "@/lib/agent/ai-dashboard/url-state";
import { readWorkspaceSpendSettings, SPEND_SETTINGS_COLUMNS } from "@/lib/ai/spend-settings";
import { AiDashboardPanel } from "./dashboard-panel";
import { SpendLimitsCard } from "./spend-limits-card";

/**
 * El lado servidor del mini dashboard (A1-A5): todo lo que toca costo o
 * tokens pasa por aca, con service role, y nunca llega al cliente del
 * usuario (00060). Server Component aparte (no inline en `page.tsx`) para
 * poder envolverlo en `<Suspense>`: el resto de la pagina (el header, la
 * lista de agentes) no espera a esto.
 */
export async function AiDashboardSection({
  workspaceId,
  timeZone,
  filter,
  firstAgentId,
  canEditLimits,
}: {
  workspaceId: string;
  timeZone: string;
  filter: PeriodFilter;
  firstAgentId: string | null;
  /** Owner/Admin: pueden guardar los topes. El resto los ve y nada mas. */
  canEditLimits: boolean;
}) {
  const service = await createServiceClient();

  // La señal de integraciones (A5) consume el estado que G3 ya resuelve:
  // no se recalculan vencimientos ni scopes aca.
  const [data, counts, integrations, workspaceRow] = await Promise.all([
    loadAiDashboardData(service, { workspaceId, filter, timeZone }),
    loadRunCounts24h(service, { workspaceId }),
    loadIntegrations(service, workspaceId),
    service.from("workspaces").select(SPEND_SETTINGS_COLUMNS).eq("id", workspaceId).maybeSingle(),
  ]);

  const cards = buildAiKpiCards({
    totals: data.totals,
    previousTotals: data.previousTotals,
    todayCost: data.todayCost,
    yesterdayCost: data.yesterdayCost,
  });

  const systemStatus = computeSystemStatus({
    runsLast24h: counts.runs,
    errorsLast24h: counts.errors,
    integrationStatuses: Object.values(integrations.integrations).map((i) => i.status),
    missingPricing: data.totals.missingPricing,
  });

  return (
    <AiDashboardPanel
      cards={cards}
      systemStatus={systemStatus}
      periodQuery={periodFilterToParams(filter).toString()}
      firstAgentId={firstAgentId}
      spendByDay={data.spendByDay}
      timeZone={timeZone}
      range={data.range}
      hasAnyRuns={data.totals.runs > 0}
      limitsCard={<SpendLimitsCard settings={readWorkspaceSpendSettings(workspaceRow.data)} canEdit={canEditLimits} />}
    />
  );
}
