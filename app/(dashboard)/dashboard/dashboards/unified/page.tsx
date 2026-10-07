import { requireWorkspaceAdmin, getPermissionContext } from "@/lib/auth/guards";
import { availableDashboards } from "@/lib/dashboards/available";
import { UnifiedDashboard } from "@/components/dashboards/unified-dashboard";
import { loadContentDashboard } from "@/lib/dashboards/content-load";
import { loadAdsInsights } from "@/lib/dashboards/ads-load";
import { buildUnified, type OrganicSummary, type PaidSummary } from "@/lib/dashboards/unified";
import { computeTotals, dailySeries } from "@/lib/dashboards/ads";
import { followerGrowth, sumByBucket, total } from "@/lib/dashboards/content";
import { isPeriodPreset, resolvePeriod, type PeriodPreset } from "@/lib/dashboards/period";
import { DEFAULT_PERIOD } from "@/lib/dashboards/url-state";
import { parseMetaConfig, resolveSyncedAccount, syncedAccounts } from "@/lib/meta/accounts";
import { resolveViewerTimezone } from "@/lib/user-timezone";

export const dynamic = "force-dynamic";

/**
 * El dashboard unificado (F59).
 *
 * Lee las dos fuentes y deja que `buildUnified` decida que mostrar: si
 * falta una, se muestra la otra con su aviso.
 */
export default async function UnifiedDashboardPage({
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

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const range = resolvePeriod(period, new Date(), timeZone);

  const [{ data: configRow }, { data: accounts }, content] = await Promise.all([
    supabase
      .from("integration_configs")
      .select("config")
      .eq("workspace_id", workspace.id)
      .eq("type", "meta")
      .eq("provider", "meta")
      .maybeSingle(),
    supabase
      .from("social_accounts")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("is_active", true),
    loadContentDashboard(supabase, { workspaceId: workspace.id, period: range, timeZone }),
  ]);

  const config = parseMetaConfig(configRow?.config);
  const adAccounts = syncedAccounts(config.ad_accounts);
  const resolved = resolveSyncedAccount(config.ad_accounts);

  const adsRows = resolved.ok
    ? await loadAdsInsights(supabase, {
        workspaceId: workspace.id,
        adAccountId: resolved.adAccountId,
        period: range,
        timeZone,
      })
    : [];

  const accountLevel = adsRows.filter((r) => r.level === "account");
  const adsTotals = computeTotals(accountLevel);

  const organic: OrganicSummary | null =
    (accounts ?? []).length > 0
      ? {
          reach: total(content.postDaily.map((r) => ({ value: r.reach ?? r.views }))),
          interactions: total(
            content.postDaily.map((r) => ({
              value: [r.likes, r.comments, r.shares, r.saves]
                .filter((v): v is number => v !== null)
                .reduce((a, b) => a + b, 0),
            })),
          ),
          followersGained: total(
            followerGrowth(content.accountDaily, "day").map((g) => ({ value: g.gained })),
          ),
          posts: content.posts.length,
          daily: sumByBucket(
            content.postDaily.map((r) => ({ date: r.date, value: r.reach ?? r.views })),
            "day",
          ).map((p) => ({ date: p.bucket, reach: p.value })),
        }
      : null;

  const paid: PaidSummary | null =
    adAccounts.length > 0
      ? {
          reach: adsTotals.reach,
          spend: adsTotals.spend,
          leads: adsTotals.leads,
          impressions: adsTotals.impressions,
          clicks: adsTotals.clicks,
          daily: dailySeries(accountLevel, "reach").map((point) => ({
            date: point.bucket,
            reach: point.value,
            spend: dailySeries(accountLevel, "spend").find((s) => s.bucket === point.bucket)?.value ?? null,
          })),
        }
      : null;

  const view = buildUnified({
    organic,
    paid,
    organicConnected: (accounts ?? []).length > 0,
    paidConnected: adAccounts.length > 0,
  });

  return (
    <UnifiedDashboard
      dashboards={dashboards}
      view={view}
      period={period}
      currency={adAccounts[0]?.currency ?? null}
    />
  );
}
