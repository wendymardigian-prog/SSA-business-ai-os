import { requirePermission } from "@/lib/auth/guards";
import { availableDashboards } from "@/lib/dashboards/available";
import { CallsDashboard } from "@/components/dashboards/calls/calls-dashboard";
import { closerSummaries, computeHeadline, criteriaAverages, qualificationMatrix, topObjections, weeklyEvolution } from "@/lib/dashboards/calls";
import { loadCallRows } from "@/lib/dashboards/calls-load";
import { PERIOD_LABELS, resolvePeriod } from "@/lib/dashboards/period";
import { parsePeriodFilter } from "@/lib/agent/ai-dashboard/url-state";
import { formatRange, isoRangeToCivil } from "@/lib/dashboards/chat/date-range";
import { resolveCallTaskSettings } from "@/lib/calls/task-settings";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { getWorkspaceMembers } from "@/lib/workspace-members";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dashboard de Llamadas: como le va al equipo y a cada closer.
 *
 * Pide `calls.view`. Lee con el cliente del usuario: la RLS de `calls` decide
 * que ve cada quien, asi un Member con alcance propio ve solo los numeros de
 * sus llamadas.
 */
export default async function CallsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("calls.view");
  const { workspace, supabase } = ctx;
  const dashboards = availableDashboards(ctx.can);
  const sp = await searchParams;

  const urlParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") urlParams.set(k, v);
  const filter = parsePeriodFilter(urlParams);

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const range = filter.from && filter.to ? { from: filter.from, to: filter.to } : resolvePeriod(filter.period, new Date(), timeZone);

  // Los closers que se pueden elegir: quienes estan marcados como closer. Un id inventado en la URL se ignora.
  const [members, { data: closerFlags }, service] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    supabase.from("workspace_members").select("user_id").eq("workspace_id", workspace.id).eq("is_closer", true),
    createServiceClient(),
  ]);
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const closers = (closerFlags ?? []).map((c) => ({ id: c.user_id, name: names.get(c.user_id) ?? "Sin nombre" })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const requested = typeof sp.closer === "string" && UUID.test(sp.closer) ? sp.closer : null;
  const closerId = requested && closers.some((c) => c.id === requested) ? requested : null;

  const [{ calls, truncated, failed }, { data: wsRow }] = await Promise.all([
    loadCallRows(supabase, { workspaceId: workspace.id, range, closerId }),
    service.from("workspaces").select("ai_background_settings").eq("id", workspace.id).maybeSingle(),
  ]);
  const categories = resolveCallTaskSettings(wsRow?.ai_background_settings).call_analysis.categories;

  const custom = filter.from && filter.to ? isoRangeToCivil(filter.from, filter.to, timeZone) : null;
  const periodLabel = custom ? formatRange(custom) : PERIOD_LABELS[filter.period];

  return (
    <CallsDashboard
      dashboards={dashboards}
      timezone={timeZone}
      closers={closers}
      headline={computeHeadline(calls)}
      teamCriteria={criteriaAverages(calls)}
      closerRows={closerSummaries(calls, names)}
      objections={topObjections(calls, categories)}
      matrix={qualificationMatrix(calls)}
      weeks={weeklyEvolution(calls, timeZone)}
      periodLabel={periodLabel}
      closerFilterName={closerId ? (names.get(closerId) ?? null) : null}
      truncated={truncated}
      failed={failed}
    />
  );
}
