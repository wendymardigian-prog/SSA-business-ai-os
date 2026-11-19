import { requirePermission } from "@/lib/auth/guards";
import { availableDashboards } from "@/lib/dashboards/available";
import { AdsDashboard } from "@/components/dashboards/ads-dashboard";
import { loadAdsInsights } from "@/lib/dashboards/ads-load";
import { EMPTY_CRM, loadCrmForRows } from "@/lib/dashboards/ads-crm-load";
import { accountReachOf, neverRejects, previousReachOf, type DashboardReach } from "@/lib/dashboards/ads-live";
import { previousPeriod } from "@/lib/dashboards/period";
import { readDashboardPeriod, resolveDashboardPeriod } from "@/lib/dashboards/period-filter";
import { parseMetaConfig, resolveSyncedAccount, syncedAccounts } from "@/lib/meta/accounts";
import { getMetaToken } from "@/lib/meta/token";
import { fetchBreakdown, fetchReachByLevel, fetchUniqueReach, type BreakdownKind } from "@/lib/meta/live";
import { lastSyncedAt, syncedLabel } from "@/lib/dashboards/ads-view";
import { loadTaskModel } from "@/lib/ai-tasks/model";
import { createServiceClient } from "@/lib/supabase/server";
import { isoToDateInput } from "@/lib/dates";
import { resolveViewerTimezone } from "@/lib/user-timezone";

export const dynamic = "force-dynamic";

/**
 * Dashboard de Meta Ads (F56, F58).
 *
 * El alcance del periodo se pide EN VIVO: el guardado por dia no se puede
 * sumar sin contar dos veces a quien vio el anuncio dos dias. Si esa
 * consulta falla, la pantalla se muestra igual con la suma y lo aclara.
 *
 * Lo de Meta en vivo y el CRM viajan como promesas sin esperar: la cabecera
 * no queda colgada de la Graph API (cada consulta corta a los 8 segundos).
 */
export default async function AdsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // El permiso, no el cargo (F32): Owner y Admin lo tienen siempre; un rol personalizado, si se lo dieron.
  const permissions = await requirePermission("dashboards.ads.view");
  const { workspace, supabase } = permissions;
  const dashboards = availableDashboards(permissions.can);
  const canSync = permissions.can("settings.general");
  const sp = await searchParams;

  const period = readDashboardPeriod(sp);

  // La lista de cuentas publicitarias esta en `integration_configs`, que solo lee un Admin: con el permiso de la
  // pantalla alcanza para VER las cuentas, asi que se lee con el cliente de servicio, filtrada por el workspace de la sesion.
  const service = await createServiceClient();
  // Nada de esto depende de lo otro: van juntos, asi la base contesta en una sola vuelta y no en cuatro.
  // Con el de servicio: desde la 00143 `read_secret` solo la ejecuta el servidor. El workspace sale de la sesion.
  const [{ data: configRow }, timeZone, token, aiChoice] = await Promise.all([
    service
      .from("integration_configs")
      .select("config")
      .eq("workspace_id", workspace.id)
      .eq("type", "meta")
      .eq("provider", "meta")
      .maybeSingle(),
    resolveViewerTimezone(workspace.timezone),
    getMetaToken(service, workspace.id),
    loadTaskModel(service, workspace.id, "ads_analysis"),
  ]);

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
        aiModel={null}
        live={null}
        syncedLabel={null}
      />
    );
  }

  const adAccountId = resolved.adAccountId;
  const account = accounts.find((a) => a.ad_account_id === adAccountId);

  const now = new Date();
  const range = resolveDashboardPeriod(period, now, timeZone);
  const before = previousPeriod(range, now);

  const sinceOf = (period: { from: string | null }) => (period.from ? isoToDateInput(period.from, timeZone) : null);
  const untilOf = (period: { to: string | null }) => isoToDateInput(period.to ?? now.toISOString(), timeZone);

  const since = sinceOf(range);
  const until = untilOf(range);

  // Lo guardado en la base se espera: es poco y lo usa casi toda la pantalla (y la cabecera, la hora del sync).
  const [rows, previousRows] = await Promise.all([
    loadAdsInsights(supabase, { workspaceId: workspace.id, adAccountId, period: range, timeZone }),
    loadAdsInsights(supabase, { workspaceId: workspace.id, adAccountId, period: before, timeZone }),
  ]);

  // Lo de Meta en vivo y el CRM NO se esperan: la cabecera, el periodo y los filtros se dibujan enseguida y cada
  // tarjeta aparece cuando llega lo suyo (como el dashboard de Chat). Ninguna de estas promesas rechaza.
  const noLive = () => null;

  const breakdownOf = (breakdown: BreakdownKind) =>
    neverRejects(
      token && since ? fetchBreakdown({ token, adAccountId, breakdown, since, until }) : Promise.resolve(null),
      `el desglose ${breakdown}`,
      noLive,
    );

  const reach: Promise<DashboardReach> = neverRejects(
    Promise.all([
      token && since ? fetchUniqueReach({ token, adAccountId, since, until }) : Promise.resolve(null),
      // El alcance unico del periodo anterior, para que la variacion compare
      // lo mismo con lo mismo: el actual es unico y el anterior, sumado por
      // dia, seria otro numero.
      token && before.from
        ? fetchUniqueReach({ token, adAccountId, since: sinceOf(before) as string, until: untilOf(before) })
        : Promise.resolve(null),
    ]).then(([current, previous]) => ({ current: accountReachOf(current), previous: previousReachOf(previous) })),
    "el alcance del periodo",
    (message) => ({ current: { uniqueReach: null, uniqueFrequency: null, liveError: message }, previous: null }),
  );

  // El alcance unico de cada anuncio, para la comparativa: sumar los dias contaria dos veces a quien lo vio en dos dias
  // distintos. El de las filas de la tabla lo pide la tabla, solo si esas columnas estan a la vista.
  const adReach = neverRejects(
    (token && since
      ? fetchReachByLevel({ token, adAccountId, level: "ad", since, until })
      : Promise.resolve(null)
    ).then((result) => (result?.ok ? result.data : null)),
    "el alcance por anuncio",
    noLive,
  );

  // Lo que dice el CRM por campaña, conjunto y anuncio (AT4). Con la sesion de quien mira: la RLS decide que leads,
  // agendas y ventas cuenta. Si algo falla, el dashboard se ve igual con lo de Meta y la tabla avisa.
  const crm = neverRejects(
    loadCrmForRows(permissions, { adAccountId, rows, since: since ?? "2000-01-01", until, timeZone, now }),
    "el CRM",
    (message) => ({ ...EMPTY_CRM, since: since ?? "2000-01-01", until, adAccountId, timeZone, error: message }),
  );

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
      live={{
        reach,
        adReach,
        placement: breakdownOf("publisher_platform,platform_position"),
        device: breakdownOf("device_platform"),
        audience: breakdownOf("age,gender"),
        crm,
      }}
      aiModel={aiChoice ? `${aiChoice.provider}/${aiChoice.model}` : null}
      syncedLabel={syncedLabel(syncedAt, now, timeZone)}
      canSync={canSync}
    />
  );
}
