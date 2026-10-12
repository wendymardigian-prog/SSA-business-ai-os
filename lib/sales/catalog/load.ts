/**
 * Lecturas del catálogo para las pantallas de Ajustes > Productos. Con el
 * cliente del usuario: la RLS (00159) deja leer a cualquier miembro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { countUsage } from "@/lib/content/taxonomy";
import { pieceClassification } from "@/lib/content/taxonomy-usage";
import { productRow, type ProductRow } from "./products";
import { priceOrNull } from "./price";

type Db = SupabaseClient<Database>;

/** La lista de productos con lo que muestra cada fila. */
export async function loadProductList(supabase: Db, workspaceId: string): Promise<ProductRow[]> {
  const [products, variants, classified] = await Promise.all([
    supabase.from("products").select("id, name, product_type, status, description").eq("workspace_id", workspaceId),
    supabase.from("product_variants").select("id, product_id, display_order, price, archived_at").eq("workspace_id", workspaceId),
    pieceClassification(supabase, workspaceId),
  ]);
  if (products.error) console.error("[catalog] no pude leer los productos:", products.error.message);

  const uses = countUsage(classified.map((r) => r.offer_id));

  return (products.data ?? []).map((p) =>
    productRow(
      p,
      (variants.data ?? [])
        .filter((v) => v.product_id === p.id)
        .map((v) => ({ display_order: v.display_order, archived_at: v.archived_at, activePrice: priceOrNull(v.price) })),
      uses.get(p.id) ?? 0,
    ),
  );
}

export interface CatalogVariant {
  id: string;
  name: string;
  duration_type: string;
  duration_value: number | null;
  guarantee_duration_type: string | null;
  guarantee_duration_value: number | null;
  billing_type: string;
  billing_interval: string | null;
  display_order: number;
  archived_at: string | null;
  /** El precio de la columna (0 = sin precio). */
  price: number;
  /** El precio si tiene, o null si no (no se puede vender). */
  activePrice: number | null;
}

export interface ProductDetailData {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  pieces: number;
  variants: CatalogVariant[];
}

/** Un producto con sus variantes y el precio de cada una; null si no existe en este workspace. */
export async function loadProductDetail(supabase: Db, workspaceId: string, productId: string): Promise<ProductDetailData | null> {
  const { data: product } = await supabase
    .from("products")
    .select("id, name, description, product_type, status")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!product) return null;

  const { data: variants } = await supabase
    .from("product_variants")
    .select("id, name, duration_type, duration_value, guarantee_duration_type, guarantee_duration_value, billing_type, billing_interval, display_order, price, archived_at")
    .eq("product_id", productId)
    .eq("workspace_id", workspaceId)
    .order("display_order");
  const classified = await pieceClassification(supabase, workspaceId);
  const pieces = classified.filter((r) => r.offer_id === productId).length;

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    type: product.product_type,
    status: product.status,
    pieces,
    variants: (variants ?? []).map((v) => ({ ...v, price: Number(v.price) || 0, activePrice: priceOrNull(v.price) })),
  };
}
