import { requirePermission } from "@/lib/auth/guards";
import { availableDashboards } from "@/lib/dashboards/available";
import { ContentDashboard } from "@/components/dashboards/content-dashboard";
import { parseClassificationParams } from "@/lib/dashboards/content-params";
import { loadContentDashboard } from "@/lib/dashboards/content-load";
import { isPeriodPreset, previousPeriod, resolvePeriod, type PeriodPreset } from "@/lib/dashboards/period";
import { DEFAULT_PERIOD } from "@/lib/dashboards/url-state";

export const dynamic = "force-dynamic";

/**
 * Dashboard de contenido organico (F48 a F50, F53).
 *
 * Pide `dashboards.content.view` (F78). Owner y Admin lo tienen siempre y un
 * rol personalizado se lo puede dar a un Member: las tablas de metricas lo
 * leen por la misma clave (00113). "Actualizar ahora" sigue siendo de Owner y
 * Admin, porque gasta llamadas a las redes.
 *
 * Se leen dos periodos: el elegido y el anterior del mismo largo, que es
 * contra lo que se compara cada cifra.
 */
export default async function ContentDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePermission("dashboards.content.view");
  const { workspace, supabase, role } = ctx;
  const dashboards = availableDashboards(ctx.can);
  const sp = await searchParams;

  const periodParam = typeof sp.periodo === "string" ? sp.periodo : null;
  const period: PeriodPreset =
    periodParam && isPeriodPreset(periodParam) ? periodParam : DEFAULT_PERIOD;
  const platform = typeof sp.red === "string" ? sp.red : null;
  // Agrupar y filtrar por la clasificacion de la pieza (F105).
  const { group, filters } = parseClassificationParams(sp);

  const timeZone = workspace.timezone || "America/Costa_Rica";
  const now = new Date();
  const range = resolvePeriod(period, now, timeZone);
  const before = previousPeriod(range, now);

  const [current, previous, accountsRes] = await Promise.all([
    loadContentDashboard(supabase, { workspaceId: workspace.id, period: range, platform, filters }),
    // El periodo anterior con los mismos filtros: si no, "▲ 40%" compararia
    // una oferta contra todo el contenido.
    loadContentDashboard(supabase, { workspaceId: workspace.id, period: before, platform, filters }),
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
      pieces={[...current.pieces.values()]}
      leadsByPost={current.leadsByPost ? [...current.leadsByPost.entries()] : null}
      group={group}
      filters={filters}
      filterOptions={current.filterOptions}
      canRefresh={role === "owner" || role === "admin"}
    />
  );
}
