import { requirePermission } from "@/lib/auth/guards";
import { AdsTablePage } from "@/components/dashboards/ads-table-page";
import { loadAdsTablePage } from "@/lib/dashboards/ads-table-page";

export const dynamic = "force-dynamic";

/**
 * Anuncios: la tabla de campañas, conjuntos y anuncios, con su propio lugar en el menu.
 * Es la misma del dashboard de Meta Ads y pide el mismo permiso.
 */
export default async function AnunciosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const permissions = await requirePermission("dashboards.ads.view");
  const data = await loadAdsTablePage(permissions, await searchParams);
  return <AdsTablePage {...data} />;
}
