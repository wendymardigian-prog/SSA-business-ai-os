import { redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { defaultDashboard } from "@/lib/dashboards/default";
import { parseMetaConfig, syncedAccounts } from "@/lib/meta/accounts";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Entrada de Dashboards: manda al que corresponde por defecto.
 *
 * Meta Ads si esta conectado (alguna cuenta publicitaria sincronizando) y la persona
 * puede verlo; si no, Chat (`lib/dashboards/default.ts`). Es lo que abre el menu
 * lateral y `/dashboard`.
 *
 * Que haya una cuenta lo dice `integration_configs`, que solo lee un Admin: con el
 * permiso de anuncios alcanza para mirar ESO, asi que se lee con el cliente de
 * servicio, filtrado por el workspace de la sesion (como `dashboards/ads/page.tsx`).
 * Si la lectura falla, se abre Chat: entrar nunca se rompe por esto.
 */
export default async function DashboardsEntryPage() {
  const ctx = await getPermissionContext();

  let adsConnected = false;
  if (ctx.can("dashboards.ads.view")) {
    try {
      const service = await createServiceClient();
      const { data } = await service
        .from("integration_configs")
        .select("config")
        .eq("workspace_id", ctx.workspace.id)
        .eq("type", "meta")
        .eq("provider", "meta")
        .maybeSingle();
      adsConnected = syncedAccounts(parseMetaConfig(data?.config).ad_accounts).length > 0;
    } catch (err) {
      console.error("[dashboards] no pude ver si Meta esta conectado; abro Chat:", err instanceof Error ? err.message : String(err));
    }
  }

  redirect(defaultDashboard({ can: ctx.can, adsConnected }));
}
