// @plantilla-quitar(servicios)
/**
 * Lo que necesita el modal «+ Servicio» (F30): productos con sus variantes vivas, el equipo y la fecha de hoy en la zona
 * del NEGOCIO (`workspaces.timezone`, no la de quien mira), que es la fecha de inicio por defecto. Con el cliente del usuario.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewServiceOptions } from "@/components/services/clients/new-service-dialog";
import { todayIn } from "@/lib/services/screens/today";

type Db = SupabaseClient<any, any, any>;

export async function loadNewServiceOptions(supabase: Db, workspaceId: string, team: Array<{ userId: string; name: string }>, canOffRule: boolean, timeZone: string | null | undefined): Promise<NewServiceOptions> {
  const [products, variants] = await Promise.all([
    supabase.from("products").select("id, name, product_type").eq("workspace_id", workspaceId).is("archived_at", null).order("name"),
    supabase.from("product_variants").select("id, product_id, name, event_date").eq("workspace_id", workspaceId).is("archived_at", null).order("display_order"),
  ]);
  const vs = (variants.data ?? []) as Array<{ id: string; product_id: string; name: string; event_date: string | null }>;
  return {
    products: ((products.data ?? []) as Array<{ id: string; name: string; product_type: string | null }>)
      .map((p) => ({
        id: p.id,
        name: p.name,
        variants: vs
          .filter((v) => v.product_id === p.id)
          .map((v) => ({ id: v.id, name: v.name, eventDate: p.product_type === "evento" ? v.event_date : null })),
      }))
      .filter((p) => p.variants.length > 0),
    members: team.map((m) => ({ id: m.userId, name: m.name })),
    canOffRule,
    today: todayIn(timeZone),
  };
}
