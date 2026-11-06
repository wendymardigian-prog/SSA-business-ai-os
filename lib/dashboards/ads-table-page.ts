/**
 * Lo que necesita la pantalla Anuncios (`/dashboard/anuncios`): la tabla de campañas, conjuntos y anuncios, sin el
 * resto del dashboard de Meta Ads. Por eso pide mucho menos a Meta en vivo: solo el alcance unico de la cuenta, que
 * es lo que usa la fila de total.
 *
 * El permiso lo chequea la pagina y entra por `permissions`: el workspace sale siempre de la sesion.
 */

import type { PermissionContext } from "@/lib/auth/guards";
import { isoToDateInput } from "@/lib/dates";
import { parseMetaConfig, resolveSyncedAccount, syncedAccounts } from "@/lib/meta/accounts";
import { fetchUniqueReach } from "@/lib/meta/live";
import { getMetaToken } from "@/lib/meta/token";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import type { AdsRow } from "./ads";
import { loadCrmForRows, type CrmTableData } from "./ads-crm-load";
import { loadAdsInsights } from "./ads-load";
import { lastSyncedAt, syncedLabel as buildSyncedLabel } from "./ads-view";
import { isPeriodPreset, resolvePeriod, type PeriodPreset } from "./period";
import { DEFAULT_PERIOD } from "./url-state";

export interface AdsTablePageData {
  rows: AdsRow[];
  accounts: Array<{ id: string; name: string | null; currency: string | null }>;
  adAccountId: string;
  currency: string | null;
  period: PeriodPreset;
  /** El alcance unico del periodo, de la consulta en vivo. Null si no se pudo leer: el total usa la suma de los dias. */
  uniqueReach: number | null;
  liveError: string | null;
  /** "hoy 14:32": cuando escribio el sync por ultima vez. */
  syncedLabel: string | null;
  /** Null solo si no hay ninguna cuenta. */
  crm: CrmTableData | null;
}

export async function loadAdsTablePage(
  permissions: PermissionContext,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<AdsTablePageData> {
  const { workspace, supabase } = permissions;

  const periodParam = typeof searchParams.periodo === "string" ? searchParams.periodo : null;
  const period: PeriodPreset = periodParam && isPeriodPreset(periodParam) ? periodParam : DEFAULT_PERIOD;

  // Las cuentas estan en `integration_configs` (solo la lee un Admin): con el permiso de la pantalla se leen con el
  // cliente de servicio, filtradas por el workspace de la sesion.
  const service = await createServiceClient();
  const { data: configRow } = await service
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", workspace.id)
    .eq("type", "meta")
    .eq("provider", "meta")
    .maybeSingle();

  const config = parseMetaConfig(configRow?.config);
  const accounts = syncedAccounts(config.ad_accounts);
  const resolved = resolveSyncedAccount(config.ad_accounts, typeof searchParams.cuenta === "string" ? searchParams.cuenta : undefined);

  if (!resolved.ok) {
    return { rows: [], accounts: [], adAccountId: "", currency: null, period, uniqueReach: null, liveError: null, syncedLabel: null, crm: null };
  }

  const adAccountId = resolved.adAccountId;
  const account = accounts.find((a) => a.ad_account_id === adAccountId);

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const now = new Date();
  const range = resolvePeriod(period, now, timeZone);
  const since = range.from ? isoToDateInput(range.from, timeZone) : null;
  const until = isoToDateInput(range.to ?? now.toISOString(), timeZone);

  // Con el de servicio: desde la 00143 `read_secret` solo la ejecuta el servidor.
  const token = await getMetaToken(service, workspace.id);

  const [rows, live] = await Promise.all([
    loadAdsInsights(supabase, { workspaceId: workspace.id, adAccountId, period: range, timeZone }),
    token && since ? fetchUniqueReach({ token, adAccountId, since, until }) : Promise.resolve(null),
  ]);

  const crm = await loadCrmForRows(permissions, { adAccountId, rows, since: since ?? "2000-01-01", until, timeZone, now });
  const syncedAt = lastSyncedAt(rows.filter((r) => r.level === "account")) ?? account?.last_synced_at ?? null;

  return {
    rows,
    accounts: accounts.map((a) => ({ id: a.ad_account_id, name: a.name, currency: a.currency })),
    adAccountId,
    currency: account?.currency ?? null,
    period,
    uniqueReach: live?.ok ? live.data.reach : null,
    liveError: live && !live.ok ? live.error : null,
    syncedLabel: buildSyncedLabel(syncedAt, now, timeZone),
    crm,
  };
}
