/**
 * Carga los últimos toques de las reuniones de una página de Agenda (`booking_last_touches`, 00358) con sus nombres.
 *
 * Los toques se leen con el cliente de SERVICIO y solo con ids de reuniones que la persona ya leyó con su sesión (quien
 * atiende una reunión puede no ver el contacto, y entonces la RLS de `contact_touches` no le devolvería nada). Los nombres
 * (piezas, anuncios) y las miniaturas van con la SESIÓN de quien mira: lo que su RLS no deja ver queda afuera y el toque se
 * nombra con lo que trae. Nunca lanza: un fallo deja el mapa vacío y la pantalla muestra «—».
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { groupLastTouches, LAST_TOUCHES_SHOWN, NO_LAST_TOUCH_NAMES, type BookingTouchView, type LastTouchNames, type LastTouchRow } from "./last-touches";

const THUMBNAIL_SECONDS = 3600;
/** La consulta lleva los ids en un arreglo: de a tandas razonables. */
const PER_CALL = 100;

export async function loadBookingLastTouches(
  service: SupabaseClient,
  supabase: SupabaseClient,
  workspaceId: string,
  bookingIds: readonly string[],
): Promise<Record<string, BookingTouchView[]>> {
  const ids = [...new Set(bookingIds)];
  if (ids.length === 0) return {};

  const rows: LastTouchRow[] = [];
  try {
    for (let i = 0; i < ids.length; i += PER_CALL) {
      const { data, error } = await service.rpc("booking_last_touches", {
        p_workspace_id: workspaceId,
        p_booking_ids: ids.slice(i, i + PER_CALL),
        p_limit: LAST_TOUCHES_SHOWN,
      });
      if (error) {
        console.error("[atribucion] no pude leer los ultimos toques, code=", error.code);
        return {};
      }
      rows.push(...((data ?? []) as unknown as LastTouchRow[]));
    }
  } catch (err) {
    console.error("[atribucion] los ultimos toques fallaron:", err instanceof Error ? err.message : "error desconocido");
    return {};
  }
  if (rows.length === 0) return {};

  const names = await loadNames(supabase, workspaceId, rows);
  return groupLastTouches(rows, names);
}

async function loadNames(supabase: SupabaseClient, workspaceId: string, rows: readonly LastTouchRow[]): Promise<LastTouchNames> {
  const names: LastTouchNames = { pieces: {}, ads: {}, adThumbnails: {} };
  const pieceIds = [...new Set(rows.map((r) => r.content_post_id).filter((v): v is string => !!v))];
  const adIds = [...new Set(rows.map((r) => r.meta_ad_id ?? r.ad_id).filter((v): v is string => !!v))];
  try {
    const [pieces, ads] = await Promise.all([
      pieceIds.length > 0 ? supabase.from("content_posts").select("id, title").eq("workspace_id", workspaceId).in("id", pieceIds) : null,
      adIds.length > 0 ? supabase.from("meta_ads").select("ad_id, name, thumbnail_path").eq("workspace_id", workspaceId).in("ad_id", adIds) : null,
    ]);
    for (const p of (pieces?.data ?? []) as Array<{ id: string; title: string | null }>) if (p.title) names.pieces[p.id] = p.title;

    const adRows = (ads?.data ?? []) as Array<{ ad_id: string; name: string | null; thumbnail_path: string | null }>;
    for (const a of adRows) if (a.name) names.ads[a.ad_id] = a.name;

    // Las miniaturas, de una sola vez. El bucket pide `dashboards.ads.view`: sin el permiso no viene nada.
    const withThumb = adRows.filter((a) => a.thumbnail_path);
    if (withThumb.length > 0) {
      const { data } = await supabase.storage.from("ad-creatives").createSignedUrls(
        withThumb.map((a) => a.thumbnail_path as string),
        THUMBNAIL_SECONDS,
      );
      for (const signed of data ?? []) {
        const ad = withThumb.find((a) => a.thumbnail_path === signed.path);
        if (ad && signed.signedUrl) names.adThumbnails[ad.ad_id] = signed.signedUrl;
      }
    }
  } catch (err) {
    console.error("[atribucion] no pude leer los nombres de los toques:", err instanceof Error ? err.message : "error desconocido");
    return NO_LAST_TOUCH_NAMES;
  }
  return names;
}
