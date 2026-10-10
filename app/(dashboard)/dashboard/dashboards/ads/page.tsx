import { requireWorkspaceAdmin, getPermissionContext } from "@/lib/auth/guards";
import { availableDashboards } from "@/lib/dashboards/available";
import { AdsDashboard } from "@/components/dashboards/ads-dashboard";
import { loadAdsInsights } from "@/lib/dashboards/ads-load";
import { isPeriodPreset, previousPeriod, resolvePeriod, type PeriodPreset } from "@/lib/dashboards/period";
import { DEFAULT_PERIOD } from "@/lib/dashboards/url-state";
import { parseMetaConfig, resolveSyncedAccount, syncedAccounts } from "@/lib/meta/accounts";
import { getMetaToken } from "@/lib/meta/token";
import { fetchUniqueReach } from "@/lib/meta/live";
import { lastSyncedAt, syncedLabel } from "@/lib/dashboards/ads-view";
import { isoToDateInput } from "@/lib/dates";
import { resolveViewerTimezone } from "@/lib/user-timezone";

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
  const dashboards = availableDashboards((await getPermissionContext()).can);
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
        dashboards={dashboards}
        rows={[]}
        previousRows={[]}
        accounts={[]}
        account={null}
        adAccountId=""
        currency={null}
        period={period}
        uniqueReach={null}
        previousUniqueReach={null}
        liveError={null}
        syncedLabel={null}
      />
    );
  }

  const adAccountId = resolved.adAccountId;
  const account = accounts.find((a) => a.ad_account_id === adAccountId);

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const now = new Date();
  const range = resolvePeriod(period, now, timeZone);
  const before = previousPeriod(range, now);

  const token = await getMetaToken(supabase, workspace.id);

  const sinceOf = (period: { from: string | null }) => (period.from ? isoToDateInput(period.from, timeZone) : null);
  const untilOf = (period: { to: string | null }) => isoToDateInput(period.to ?? now.toISOString(), timeZone);

  const [rows, previousRows, live, previousLive] = await Promise.all([
    loadAdsInsights(supabase, { workspaceId: workspace.id, adAccountId, period: range, timeZone }),
    loadAdsInsights(supabase, { workspaceId: workspace.id, adAccountId, period: before, timeZone }),
    token && range.from
      ? fetchUniqueReach({ token, adAccountId, since: sinceOf(range) as string, until: untilOf(range) })
      : Promise.resolve(null),
    // El alcance unico del periodo anterior, para que la variacion compare
    // lo mismo con lo mismo: el actual es unico y el anterior, sumado por
    // dia, seria otro numero.
    token && before.from
      ? fetchUniqueReach({ token, adAccountId, since: sinceOf(before) as string, until: untilOf(before) })
      : Promise.resolve(null),
  ]);

  // Si alguno de los dos no llego, los dos quedan en la suma de los dias:
  // comparar un alcance unico contra uno sumado inventaria una variacion.
  const bothReach = live?.ok && previousLive?.ok;

  const syncedAt =
    lastSyncedAt(rows.filter((r) => r.level === "account")) ?? account?.last_synced_at ?? null;

  return (
    <AdsDashboard
      dashboards={dashboards}
      rows={rows}
      previousRows={previousRows}
      accounts={accounts.map((a) => ({ id: a.ad_account_id, name: a.name, currency: a.currency }))}
      account={
        account
          ? { id: account.ad_account_id, name: account.name, currency: account.currency, lastError: account.last_error }
          : null
      }
      adAccountId={adAccountId}
      currency={account?.currency ?? null}
      period={period}
      uniqueReach={bothReach ? live.data.reach : null}
      previousUniqueReach={bothReach ? previousLive.data.reach : null}
      liveError={live && !live.ok ? live.error : null}
      syncedLabel={syncedLabel(syncedAt, now, timeZone)}
    />
  );
}
