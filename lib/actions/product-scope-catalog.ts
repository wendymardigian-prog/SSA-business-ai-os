"use server";
// @plantilla-quitar(ventas)

import { getWorkspace } from "@/lib/workspace";
import type { ScopeCatalogProduct } from "@/lib/automations/product-scope";

/**
 * Los productos y sus variantes para el filtro «Productos y variantes» de los disparadores (Ventas y Servicios). Con la
 * sesión de quien edita: el catálogo lo lee cualquier miembro. Sin archivados (un filtro viejo que los nombra se ve con
 * su aviso «ya no existe»). Ante un error, `null`: el panel lo dice y no deja elegir.
 */
export async function loadProductScopeCatalog(): Promise<ScopeCatalogProduct[] | null> {
  const { workspace, supabase } = await getWorkspace();
  const [products, variants] = await Promise.all([
    supabase.from("products").select("id, name").eq("workspace_id", workspace.id).is("archived_at", null).order("name", { ascending: true }),
    supabase.from("product_variants").select("id, product_id, name, display_order").eq("workspace_id", workspace.id).is("archived_at", null).order("display_order", { ascending: true }),
  ]);
  if (products.error || variants.error) {
    console.error("[automatizaciones] no pude leer el catálogo para los filtros:", products.error?.message ?? variants.error?.message);
    return null;
  }
  const vs = (variants.data ?? []) as Array<{ id: string; product_id: string; name: string }>;
  return ((products.data ?? []) as Array<{ id: string; name: string }>).map((p) => ({
    id: p.id,
    name: p.name,
    variants: vs.filter((v) => v.product_id === p.id).map((v) => ({ id: v.id, name: v.name })),
  }));
}
