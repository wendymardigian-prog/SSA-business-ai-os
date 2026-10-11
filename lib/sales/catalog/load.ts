/**
 * Lecturas del catálogo para las pantallas de Ajustes > Productos. Con el
 * cliente del usuario: la RLS (00159) deja leer a cualquier miembro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { countUsage } from "@/lib/content/taxonomy";
import { pieceClassification } from "@/lib/content/taxonomy-usage";
import { productRow, type ProductRow } from "./products";
import { resolveActiveVersion, type VersionLike } from "./versions";
import { versionSalesCounts } from "./usage";
import type { HistoryVersion } from "./price-history";

type Db = SupabaseClient<Database>;

/** La lista de productos con lo que muestra cada fila. */
export async function loadProductList(supabase: Db, workspaceId: string): Promise<ProductRow[]> {
  const [products, variants, versions, classified] = await Promise.all([
    supabase.from("products").select("id, name, product_type, status, description").eq("workspace_id", workspaceId),
    supabase.from("product_variants").select("id, product_id, display_order, archived_at").eq("workspace_id", workspaceId),
    supabase.from("product_versions").select("product_variant_id, price").eq("workspace_id", workspaceId).eq("status", "active"),
    pieceClassification(supabase, workspaceId),
  ]);
  if (products.error) console.error("[catalog] no pude leer los productos:", products.error.message);

  const activePrice = new Map((versions.data ?? []).map((v) => [v.product_variant_id, Number(v.price) || 0]));
  const uses = countUsage(classified.map((r) => r.offer_id));

  return (products.data ?? []).map((p) =>
    productRow(
      p,
      (variants.data ?? [])
        .filter((v) => v.product_id === p.id)
        .map((v) => ({ display_order: v.display_order, archived_at: v.archived_at, activePrice: activePrice.get(v.id) ?? null })),
      uses.get(p.id) ?? 0,
    ),
  );
}

export interface VariantWithVersions {
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
  versions: HistoryVersion[];
  activePrice: number | null;
  salesByVersion: Record<string, number>;
}

export interface ProductDetailData {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  pieces: number;
  variants: VariantWithVersions[];
}

/** Un producto con sus variantes y todas las versiones de cada una; null si no existe en este workspace. */
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
    .select("id, name, duration_type, duration_value, guarantee_duration_type, guarantee_duration_value, billing_type, billing_interval, display_order, archived_at")
    .eq("product_id", productId)
    .eq("workspace_id", workspaceId)
    .order("display_order");
  const variantIds = (variants ?? []).map((v) => v.id);

  const { data: versions } = variantIds.length
    ? await supabase
        .from("product_versions")
        .select("id, product_variant_id, version_number, price, change_notes, status, published_at, published_by, deprecated_at")
        .eq("workspace_id", workspaceId)
        .in("product_variant_id", variantIds)
    : { data: [] };

  const classified = await pieceClassification(supabase, workspaceId);
  const pieces = classified.filter((r) => r.offer_id === productId).length;
  const sales = await versionSalesCounts(supabase, (versions ?? []).map((v) => v.id));

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    type: product.product_type,
    status: product.status,
    pieces,
    variants: (variants ?? []).map((v) => {
      const mine: HistoryVersion[] = (versions ?? [])
        .filter((x) => x.product_variant_id === v.id)
        .map((x) => ({
          id: x.id,
          status: x.status,
          version_number: x.version_number,
          price: Number(x.price) || 0,
          change_notes: x.change_notes,
          published_at: x.published_at,
          published_by: x.published_by,
          deprecated_at: x.deprecated_at,
        }));
      const active = safeActive(mine);
      return {
        ...v,
        versions: mine,
        activePrice: active ? Number(active.price) || 0 : null,
        salesByVersion: Object.fromEntries(mine.map((m) => [m.id, sales[m.id] ?? 0])),
      };
    }),
  };
}

function safeActive<T extends VersionLike>(versions: T[]): T | null {
  try {
    return resolveActiveVersion(versions);
  } catch (error) {
    // Dos activas no puede pasar (índice único), pero una pantalla no se rompe por eso.
    console.error("[catalog]", error instanceof Error ? error.message : error);
    return null;
  }
}
