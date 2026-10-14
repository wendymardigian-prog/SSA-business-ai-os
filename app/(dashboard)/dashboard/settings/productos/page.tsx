import { requirePermission } from "@/lib/auth/guards";
import { loadProductList } from "@/lib/sales/catalog/load";
import { ProductosView } from "./productos-view";

/**
 * Ajustes -> Productos: lo que vende el negocio, con sus variantes y su precio.
 *
 * Con Ventas (00160) el catálogo vive en `products`: cada producto tiene al
 * menos una variante (la "Estándar" de los que ya existían) y el precio está en
 * la variante (00169). Los pilares se mudaron a la página de
 * Contenido.
 *
 * Pide `products.manage` y no "ser admin": un rol personalizado con ese
 * permiso entra, y un admin al que se lo sacaron no. La RLS lo repite.
 */
export default async function ProductosSettingsPage() {
  const { workspace, supabase } = await requirePermission("products.manage");
  const rows = await loadProductList(supabase, workspace.id);
  return <ProductosView products={rows} />;
}
