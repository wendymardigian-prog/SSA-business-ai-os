import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { loadProductDetail } from "@/lib/sales/catalog/load";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { ProductDetail } from "@/components/sales/catalog/product-detail";

/**
 * Ajustes -> Productos -> un producto: sus variantes y, en cada una, el precio
 * vigente, el borrador y el historial de precios. Pide `settings.manage`.
 */
export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, supabase } = await requirePermission("settings.manage");

  const product = await loadProductDetail(supabase, workspace.id, id);
  if (!product) notFound();

  const members = await getWorkspaceMembers(workspace.id);

  return <ProductDetail product={product} userNames={Object.fromEntries(memberLabels(members))} timeZone={(workspace as { timezone?: string }).timezone ?? "UTC"} />;
}
