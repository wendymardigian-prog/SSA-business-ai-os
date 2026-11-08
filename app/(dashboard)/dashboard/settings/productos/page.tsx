import { requirePermission } from "@/lib/auth/guards";
import { loadProductList } from "@/lib/catalog/load";
import { ProductosView } from "./productos-view";
import { isModuleEnabled } from "@/lib/services/module"; // @plantilla-quitar(servicios)
import { loadServiceProducts } from "@/lib/services/screens/load-products"; // @plantilla-quitar(servicios)
import { ProductCardsView } from "@/components/services/products/product-cards-view"; // @plantilla-quitar(servicios)

/**
 * Ajustes -> Productos: lo que vende el negocio, con sus variantes y su precio.
 *
 * El catálogo vive en `products`: cada producto tiene al menos una variante y
 * el precio está en la variante (00169). Los pilares están en la página de
 * Contenido.
 *
 * Pide `products.manage` y no "ser admin": un rol personalizado con ese
 * permiso entra, y un admin al que se lo sacaron no. La RLS lo repite.
 */
export default async function ProductosSettingsPage() {
  const { workspace, supabase } = await requirePermission("products.manage");
  // @plantilla-desde(servicios)
  // Con el modulo de Servicios prendido: tarjetas por producto (F114). Apagado, la lista de siempre.
  if (isModuleEnabled(workspace as { services_enabled?: boolean | null })) {
    return <ProductCardsView products={await loadServiceProducts(supabase, workspace.id)} />;
  }
  // @plantilla-hasta(servicios)
  const rows = await loadProductList(supabase, workspace.id);
  return <ProductosView products={rows} />;
}
