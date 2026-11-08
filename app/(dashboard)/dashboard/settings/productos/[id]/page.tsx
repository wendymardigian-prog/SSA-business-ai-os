import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { loadProductDetail } from "@/lib/catalog/load";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { ProductDetail } from "@/components/catalog/product-detail";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { isModuleEnabled } from "@/lib/services/module"; // @plantilla-quitar(servicios)
import { loadServiceProduct } from "@/lib/services/screens/load-products"; // @plantilla-quitar(servicios)
import { ServiceProductPage } from "@/components/services/products/service-product-page"; // @plantilla-quitar(servicios)
import { createServiceClient } from "@/lib/supabase/server"; // @plantilla-quitar(ventas)
import { loadProductLinks } from "@/lib/affiliates/load"; // @plantilla-quitar(ventas)
import { ProductLinksCard } from "@/components/affiliates/product-links-card"; // @plantilla-quitar(ventas)

/**
 * Ajustes -> Productos -> un producto: sus variantes y, en cada una, el precio
 * vigente, el borrador y el historial de precios. Pide `products.manage`.
 */
export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("products.manage");
  const { workspace, supabase } = ctx;
  // @plantilla-desde(ventas)
  // La tarjeta Links (F70): con product_links.manage. Se lee con el cliente de servicio filtrando por el negocio.
  const links = ctx.can("product_links.manage") ? await loadProductLinks(await createServiceClient(), workspace.id, id) : null;
  const linksFor = (variants: Array<{ id: string; name: string }>) =>
    links ? <ProductLinksCard productId={id} initial={links.links} rev={links.rev} variants={variants.map((v) => ({ id: v.id, name: v.name }))} /> : null;
  // @plantilla-hasta(ventas)
  // @plantilla-sin(ventas): const linksFor = (_variants: Array<{ id: string; name: string }>): React.ReactNode => null;
  // @plantilla-desde(servicios)
  // Con el modulo de Servicios prendido: la pagina del producto con sus variantes (F114). Apagado, la ficha de siempre.
  if (isModuleEnabled(workspace as { services_enabled?: boolean | null })) {
    const sp = await loadServiceProduct(supabase, workspace.id, id);
    if (!sp) notFound();
    const team = await getWorkspaceMembers(workspace.id);
    return <ServiceProductPage product={sp} userNames={Object.fromEntries(memberLabels(team))} timeZone={await resolveViewerTimezone((workspace as { timezone?: string }).timezone)} linksCard={linksFor(sp.variants)} />;
  }
  // @plantilla-hasta(servicios)

  const product = await loadProductDetail(supabase, workspace.id, id);
  if (!product) notFound();

  const members = await getWorkspaceMembers(workspace.id);

  return <ProductDetail product={product} userNames={Object.fromEntries(memberLabels(members))} timeZone={await resolveViewerTimezone((workspace as { timezone?: string }).timezone)} linksCard={linksFor(product.variants)} />;
}
