/**
 * El catálogo para el producto de interés (00246). Con el cliente que pase
 * quien llama: los productos y las variantes los puede leer cualquier miembro
 * (RLS de 00159), así que alcanza el de la sesión. Nunca lanza: ante un error,
 * catálogo vacío (los selectores se ven vacíos y el guardado lo valida igual).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { buildInterestCatalog, type InterestCatalog } from "./interest";

export async function loadInterestCatalog(supabase: SupabaseClient<Database>, workspaceId: string): Promise<InterestCatalog> {
  const [products, variants] = await Promise.all([
    supabase.from("products").select("id, name, status, archived_at").eq("workspace_id", workspaceId),
    supabase.from("product_variants").select("id, product_id, name, archived_at, display_order").eq("workspace_id", workspaceId),
  ]);
  if (products.error) console.error("[interest] no pude leer los productos:", products.error.message);
  if (variants.error) console.error("[interest] no pude leer las variantes:", variants.error.message);
  return buildInterestCatalog(products.data ?? [], variants.data ?? []);
}
