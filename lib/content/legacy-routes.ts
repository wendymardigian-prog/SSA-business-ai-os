/**
 * Las rutas viejas de la pieza siguen funcionando (F99).
 *
 * `/dashboard/content/<id>` y `/dashboard/content/<id>/edit` eran el detalle y
 * el editor; ahora la pieza vive en un drawer sobre el tablero. Pero hay links
 * guardados, avisos en la campana y entradas de `audit_log` que apuntan a las
 * viejas, asi que no se borran: redirigen a `/dashboard/content?piece=<id>`.
 *
 * Si la pieza no existe (o no es de este negocio) NO se redirige: se muestra el
 * mismo error que mostraban antes (un 404), en vez de abrir un tablero con un
 * drawer vacio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { drawerHref } from "./drawer-url";

export async function legacyPieceHref(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  postId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("content_posts")
    .select("id")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!data) return null;
  return drawerHref(new URLSearchParams(), { kind: "piece", id: data.id });
}
