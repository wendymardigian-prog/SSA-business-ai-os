/**
 * El `?area=` del link de conectar Fathom desde un modulo: queda como el area por defecto de la
 * conexion. Viene en la vuelta firmada del OAuth, y se comprueba que sea un area de ESTE negocio.
 * Nunca pisa un area ya elegida ni tumba la conexion: conectar ya salio bien.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { categoryGroups } from "@/lib/calls/catalog";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { connectAreaFrom, parseFathomSettings } from "./settings";

export async function applyConnectArea(db: SupabaseClient<Database>, workspaceId: string, connectionId: string, redirectTo: string | null | undefined): Promise<void> {
  const area = connectAreaFrom(redirectTo);
  if (!area) return;
  try {
    const groups = categoryGroups((await listCategories(db, workspaceId)).map(toCategoryRow));
    if (!groups.some((g) => g.areaId === area)) return;
    const { data } = await db.from("oauth_connections").select("fathom_settings").eq("id", connectionId).eq("workspace_id", workspaceId).maybeSingle();
    const settings = parseFathomSettings(data?.fathom_settings);
    if (settings.default_area_id) return;
    await db.from("oauth_connections").update({ fathom_settings: { ...settings, default_area_id: area } as unknown as Json }).eq("id", connectionId).eq("workspace_id", workspaceId);
  } catch (err) {
    console.error("[fathom] no pude dejar el área de la conexión:", err instanceof Error ? err.message : "error");
  }
}
