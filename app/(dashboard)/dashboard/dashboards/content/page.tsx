import { requireWorkspaceAdmin, getPermissionContext } from "@/lib/auth/guards";
import { availableDashboards } from "@/lib/dashboards/available";
import { ContentDashboard } from "@/components/dashboards/content-dashboard";
import { loadContentDashboard } from "@/lib/dashboards/content-load";
import { isPeriodPreset, previousPeriod, resolvePeriod, type PeriodPreset } from "@/lib/dashboards/period";
import { DEFAULT_PERIOD } from "@/lib/dashboards/url-state";

export const dynamic = "force-dynamic";

/**
 * Dashboard de contenido organico (F48 a F50, F53).
 *
 * Owner/Admin: las tablas de metricas solo las lee `is_workspace_admin`
 * (00086). En el bloque 9 pasa a `dashboards.content.view`, y ahi un rol
 * personalizado puede darselo a un Member.
 *
 * Se leen dos periodos: el elegido y el anterior del mismo largo, que es
 * contra lo que se compara cada cifra.
 */
export default async function ContentDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, supabase } = await requireWorkspaceAdmin();
  const dashboards = availableDashboards((await getPermissionContext()).can);
  const sp = await searchParams;

  const periodParam = typeof sp.periodo === "string" ? sp.periodo : null;
  const period: PeriodPreset =
    periodParam && isPeriodPreset(periodParam) ? periodParam : DEFAULT_PERIOD;
  const platform = typeof sp.red === "string" ? sp.red : null;

  const timeZone = workspace.timezone || "America/Costa_Rica";
  const now = new Date();
  const range = resolvePeriod(period, now, timeZone);
  const before = previousPeriod(range, now);

  const [current, previous, accountsRes] = await Promise.all([
    loadContentDashboard(supabase, { workspaceId: workspace.id, period: range, platform }),
    loadContentDashboard(supabase, { workspaceId: workspace.id, period: before, platform }),
    supabase
      .from("social_accounts")
      .select("platform")
      .eq("workspace_id", workspace.id)
      .eq("is_active", true),
  ]);

  return (
    <ContentDashboard
      dashboards={dashboards}
      posts={current.posts}
      postDaily={current.postDaily}
      accountDaily={current.accountDaily}
      // Un Map no viaja del servidor al cliente: se manda como pares.
      latestByPost={[...current.latestByPost.entries()]}
      previous={{
        posts: previous.posts,
        postDaily: previous.postDaily,
        accountDaily: previous.accountDaily,
      }}
      accounts={current.accounts}
      lastDataByPlatform={[...current.lastDataByPlatform.entries()]}
      postDetails={[...current.postDetails.entries()]}
      connectedPlatforms={(accountsRes.data ?? []).map((a) => a.platform as string)}
      period={period}
      platform={platform}
      canRefresh
    />
  );
}
