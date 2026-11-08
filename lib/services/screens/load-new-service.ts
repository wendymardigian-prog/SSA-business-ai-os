// @plantilla-quitar(servicios)
/** Lo que necesita el modal «+ Servicio» (F30): productos con sus variantes vivas y el equipo. Con el cliente del usuario. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewServiceOptions } from "@/components/services/clients/new-service-dialog";

type Db = SupabaseClient<any, any, any>;

export async function loadNewServiceOptions(supabase: Db, workspaceId: string, team: Array<{ userId: string; name: string }>, canOffRule: boolean): Promise<NewServiceOptions> {
  const [products, variants] = await Promise.all([
    supabase.from("products").select("id, name").eq("workspace_id", workspaceId).is("archived_at", null).order("name"),
    supabase.from("product_variants").select("id, product_id, name").eq("workspace_id", workspaceId).is("archived_at", null).order("display_order"),
  ]);
  const vs = (variants.data ?? []) as Array<{ id: string; product_id: string; name: string }>;
  return {
    products: ((products.data ?? []) as Array<{ id: string; name: string }>).map((p) => ({ id: p.id, name: p.name, variants: vs.filter((v) => v.product_id === p.id).map((v) => ({ id: v.id, name: v.name })) })).filter((p) => p.variants.length > 0),
    members: team.map((m) => ({ id: m.userId, name: m.name })),
    canOffRule,
  };
}
