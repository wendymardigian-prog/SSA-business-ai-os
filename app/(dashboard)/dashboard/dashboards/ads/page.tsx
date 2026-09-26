import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { AdsDashboard } from "@/components/dashboards/ads-dashboard";
import { loadAdsInsights } from "@/lib/dashboards/ads-load";
import { isPeriodPreset, previousPeriod, resolvePeriod, type PeriodPreset } from "@/lib/dashboards/period";
import { DEFAULT_PERIOD } from "@/lib/dashboards/url-state";
import { parseMetaConfig, resolveSyncedAccount, syncedAccounts } from "@/lib/meta/accounts";
import { getMetaToken } from "@/lib/meta/token";
import { fetchUniqueReach } from "@/lib/meta/live";

export const dynamic = "force-dynamic";

/**
 * Dashboard de Meta Ads (F56, F58).
 *
 * El alcance del periodo se pide EN VIVO: el guardado por dia no se puede
 * sumar sin contar dos veces a quien vio el anuncio dos dias. Si esa
 * consulta falla, la pantalla se muestra igual con la suma y lo aclara.
 */
export default async function AdsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace, supabase } = await requireWorkspaceAdmin();
  const sp = await searchParams;

  const periodParam = typeof sp.periodo === "string" ? sp.periodo : null;
  const period: PeriodPreset =
    periodParam && isPeriodPreset(periodParam) ? periodParam : DEFAULT_PERIOD;

  const { data: configRow } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", workspace.id)
    .eq("type", "meta")
    .eq("provider", "meta")
    .maybeSingle();

  const config = parseMetaConfig(configRow?.config);
  const accounts = syncedAccounts(config.ad_accounts);

  const requested = typeof sp.cuenta === "string" ? sp.cuenta : undefined;
  const resolved = resolveSyncedAccount(config.ad_accounts, requested);

  if (!resolved.ok) {
    return (
      <AdsDashboard
        rows={[]}
        previousRows={[]}
        accounts={[]}
        adAccountId=""
        currency={null}
        period={period}
        uniqueReach={null}
        liveError={null}
      />
    );
  }

  const adAccountId = resolved.adAccountId;
  const account = accounts.find((a) => a.ad_account_id === adAccountId);

  const timeZone = workspace.timezone || "America/Costa_Rica";
  const now = new Date();
  const range = resolvePeriod(period, now, timeZone);
  const before = previousPeriod(range, now);

  const token = await getMetaToken(supabase, workspace.id);

  const [rows, previousRows, live] = await Promise.all([
    loadAdsInsights(supabase, { workspaceId: workspace.id, adAccountId, period: range }),
    loadAdsInsights(supabase, { workspaceId: workspace.id, adAccountId, period: before }),
    token && range.from
      ? fetchUniqueReach({
          token,
          adAccountId,
          since: range.from.slice(0, 10),
          until: (range.to ?? now.toISOString()).slice(0, 10),
        })
      : Promise.resolve(null),
  ]);

  return (
    <AdsDashboard
      rows={rows}
      previousRows={previousRows}
      accounts={accounts.map((a) => ({ id: a.ad_account_id, name: a.name, currency: a.currency }))}
      adAccountId={adAccountId}
      currency={account?.currency ?? null}
      period={period}
      uniqueReach={live?.ok ? live.data.reach : null}
      liveError={live && !live.ok ? live.error : null}
    />
  );
}
