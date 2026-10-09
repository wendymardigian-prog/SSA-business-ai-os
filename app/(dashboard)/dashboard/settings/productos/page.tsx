import { requirePermission } from "@/lib/auth/guards";
import { countUsage, isProductStatus, type ProductStatus } from "@/lib/content/taxonomy";
import { pieceClassification } from "@/lib/content/taxonomy-usage";
import { ProductosView, type ProductRow } from "./productos-view";

/**
 * Ajustes -> Productos: lo que vende el negocio, con su precio y su estado.
 *
 * Antes eran las "ofertas" de la pestaña Contenido. La tabla sigue siendo
 * `content_offers` (00134 le suma precio y estado). Los pilares se mudaron a
 * la pagina de Contenido, detras del boton de ajustes.
 *
 * Pide `settings.manage` y no "ser admin": un rol personalizado con ese
 * permiso entra, y un admin al que se lo sacaron no. La RLS lo repite.
 */
export default async function ProductosSettingsPage() {
  const { workspace, supabase } = await requirePermission("settings.manage");

  const [{ data: products }, classified] = await Promise.all([
    supabase
      .from("content_offers")
      .select("id, name, price_usd, status")
      .eq("workspace_id", workspace.id)
      .order("name"),
    pieceClassification(supabase, workspace.id),
  ]);

  const uses = countUsage(classified.map((r) => r.offer_id));

  const rows: ProductRow[] = (products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    priceUsd: p.price_usd === null || p.price_usd === undefined ? null : Number(p.price_usd),
    status: (isProductStatus(p.status) ? p.status : "active") as ProductStatus,
    pieces: uses.get(p.id) ?? 0,
  }));

  return <ProductosView products={rows} />;
}
