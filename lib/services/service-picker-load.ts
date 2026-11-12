// @plantilla-quitar(servicios)
/**
 * Lee los caminos de los productos del negocio para las listas de F122 (`servicePickerOptions`). Lo usa el editor de
 * automatizaciones (con la sesion: el catalogo lo lee cualquier miembro) y la validacion de publicar (con el cliente
 * que le pasen, siempre filtrando por el negocio).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { servicePickerOptions, type ServicePickerOptions } from "./service-picker";

type Db = SupabaseClient<any, any, any>;

export async function loadServicePicker(db: Db, workspaceId: string): Promise<ServicePickerOptions> {
  const [products, variants] = await Promise.all([
    db.from("products").select("id, name").eq("workspace_id", workspaceId).is("archived_at", null),
    db.from("product_variants").select("id, product_id, name, archived_at, journey_template, display_order").eq("workspace_id", workspaceId).order("display_order"),
  ]);
  if (products.error || variants.error) throw new Error(products.error?.message ?? variants.error?.message ?? "no pude leer los productos");
  const vs = (variants.data ?? []) as Array<{ id: string; product_id: string; name: string; archived_at: string | null; journey_template: unknown }>;
  return servicePickerOptions(
    ((products.data ?? []) as Array<{ id: string; name: string }>).map((p) => ({
      id: p.id,
      name: p.name,
      variants: vs.filter((v) => v.product_id === p.id).map((v) => ({ id: v.id, name: v.name, archived: !!v.archived_at, journeyTemplate: v.journey_template })),
    })),
  );
}
