/**
 * Los toques de atribucion de un contacto para la ficha (F88), con la URL de entrada (plano
 * formularios-ui, F19).
 *
 * `entry_url` es una columna nueva (00215). El codigo nuevo NO tiene que romper si la columna todavia
 * no esta en la base: si el pedido falla por columna inexistente (`42703`), se repite sin ella y la ficha
 * muestra el camino de siempre. Cualquier otro error se devuelve tal cual: nunca se toma como "sin toques".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { TouchRow } from "./attribution-view";
import type { TimelineTouch } from "./touch-timeline";

type Db = SupabaseClient<Database>;

const BASE_COLUMNS =
  "id, occurred_at, source, medium, content_label, content_post_id, origin, raw, campaign, term, ad_id, adset_id, campaign_id, fbclid, gclid, ttclid, li_fat_id, ctwa_clid, referrer_url, landing_page, meta_campaign_id, meta_adset_id, meta_ad_id, meta_match_status, meta_match_method";

/** Postgres: undefined_column. */
const UNDEFINED_COLUMN = "42703";

export async function loadContactTouches(
  supabase: Db,
  workspaceId: string,
  contactId: string,
): Promise<{ data: TouchRow[] | null; error: { code?: string; message: string } | null }> {
  const query = (columns: string) =>
    supabase
      .from("contact_touches")
      .select(columns)
      .eq("contact_id", contactId)
      .eq("workspace_id", workspaceId)
      .order("occurred_at", { ascending: true })
      .limit(100);

  // `channel` (00230) y `entry_url` (00215) son columnas nuevas: si alguna todavía no está, se repite sin ella.
  const withChannel = await query(`${BASE_COLUMNS}, entry_url, channel`);
  if (withChannel.error?.code !== UNDEFINED_COLUMN) {
    return { data: (withChannel.data as unknown as TouchRow[] | null) ?? null, error: withChannel.error };
  }
  const withEntry = await query(`${BASE_COLUMNS}, entry_url`);
  if (withEntry.error?.code === UNDEFINED_COLUMN) {
    const without = await query(BASE_COLUMNS);
    return { data: (without.data as unknown as TouchRow[] | null) ?? null, error: without.error };
  }
  return { data: (withEntry.data as unknown as TouchRow[] | null) ?? null, error: withEntry.error };
}

/** El tope de toques que lee la linea de tiempo completa (F45). Un contacto real no se acerca; si pasara, se avisa. */
export const TIMELINE_FETCH_LIMIT = 2000;

/**
 * TODOS los toques de un contacto para la linea de tiempo (Extra I, F45), del mas nuevo al mas viejo.
 *
 * Con el cliente de QUIEN MIRA: la RLS de `contact_touches` decide. Columnas explicitas (nunca `select("*")`). Las
 * columnas que sumaron migraciones recientes (`entry_url`, `channel`, `social_post_id`) se piden y, si alguna todavia no
 * esta en la base (42703), se repite con menos; cualquier otro error se devuelve tal cual, nunca como "sin toques".
 *
 * `truncated` es true si hay mas toques que el tope: la pantalla lo dice en vez de mostrar una lista que parece completa.
 */
export async function loadContactTouchTimeline(
  supabase: Db,
  workspaceId: string,
  contactId: string,
): Promise<{ data: TimelineTouch[]; truncated: boolean; error: { code?: string; message: string } | null }> {
  const query = (columns: string) =>
    supabase
      .from("contact_touches")
      .select(columns)
      .eq("contact_id", contactId)
      .eq("workspace_id", workspaceId)
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(TIMELINE_FETCH_LIMIT + 1);

  const attempts = [
    `${BASE_COLUMNS}, created_at, entry_url, channel, social_post_id`,
    `${BASE_COLUMNS}, created_at, entry_url`,
    `${BASE_COLUMNS}, created_at`,
  ];
  for (const columns of attempts) {
    const res = await query(columns);
    if (res.error?.code === UNDEFINED_COLUMN) continue;
    if (res.error) return { data: [], truncated: false, error: res.error };
    const rows = (res.data as unknown as TimelineTouch[] | null) ?? [];
    return { data: rows.slice(0, TIMELINE_FETCH_LIMIT), truncated: rows.length > TIMELINE_FETCH_LIMIT, error: null };
  }
  return { data: [], truncated: false, error: { message: "No pude leer los toques" } };
}
