/**
 * Lee de la base lo que hace falta para medir UNA pieza (F102 a F104).
 *
 * Las cuentas las hacen `piece-performance.ts`, `piece-index.ts` y
 * `piece-leads.ts`, que son puros. Esto solo trae las filas.
 *
 * Todo con el cliente de quien mira, no con el del servidor: la lista de
 * contactos tiene scope (un Member solo ve los suyos) y el numero de leads no
 * puede mostrar lo que la persona no puede ver. Si algo falla, devuelve lo que
 * pudo y lo dice en el log: medir una pieza nunca puede romper abrirla.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { INDEX_WINDOW_DAYS, type IndexPublication } from "./piece-index";
import { pieceLeads, type LeadTouch, type PieceLeads } from "./piece-leads";
import { buildPiecePerformance, type PerformancePublication, type PiecePerformance } from "./piece-performance";
import type { Snapshot } from "./post-analysis";

type Db = SupabaseClient<Database>;

/** PostgREST corta en 1000 filas sin avisar: se pide el tope a proposito. */
const PEERS_LIMIT = 1000;

interface FirstTouchRow {
  id: string;
  first_touch: {
    occurred_at?: string;
    origin?: string;
    medium?: string;
    social_post_id?: string;
    content_post_id?: string;
  } | null;
}

/** Las filas de contactos cuyo primer toque es esta pieza, como toques. */
export function touchesFromRows(rows: FirstTouchRow[]): LeadTouch[] {
  return rows
    .filter((row) => row.first_touch)
    .map((row) => ({
      contactId: row.id,
      occurredAt: row.first_touch?.occurred_at ?? "",
      origin: row.first_touch?.origin ?? null,
      medium: row.first_touch?.medium ?? null,
      socialPostId: row.first_touch?.social_post_id ?? null,
      contentPostId: row.first_touch?.content_post_id ?? null,
    }));
}

async function readLeads(
  supabase: Db,
  params: { pieceId: string; publicationIds: string[] },
): Promise<PieceLeads | null> {
  // Dos consultas en vez de un `or` sobre rutas JSON: el toque trae la pieza,
  // o solo la publicacion, y las dos formas valen. La funcion pura junta a los
  // contactos repetidos.
  const [byPiece, byPublication] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, first_touch:attribution->first_touch")
      .is("deleted_at", null)
      .eq("attribution->first_touch->>content_post_id", params.pieceId),
    params.publicationIds.length > 0
      ? supabase
          .from("contacts")
          .select("id, first_touch:attribution->first_touch")
          .is("deleted_at", null)
          .in("attribution->first_touch->>social_post_id", params.publicationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (byPiece.error || byPublication.error) {
    console.error(
      "[medicion] no pude leer los leads de la pieza:",
      byPiece.error?.message ?? byPublication.error?.message,
    );
    return null;
  }

  const rows = [...(byPiece.data ?? []), ...(byPublication.data ?? [])] as unknown as FirstTouchRow[];
  return pieceLeads({
    pieceId: params.pieceId,
    publicationIds: params.publicationIds,
    touches: touchesFromRows(rows),
  });
}

/**
 * El rendimiento de la pieza, o null si todavia no salio ninguna publicacion.
 *
 * Una pieza sin publicaciones no tiene nada que medir: el drawer no muestra la
 * seccion en vez de mostrarla en ceros.
 */
export async function loadPieceMeasurement(
  supabase: Db,
  params: { workspaceId: string; pieceId: string; now?: Date },
): Promise<PiecePerformance | null> {
  try {
    return await measure(supabase, params);
  } catch (err) {
    // Medir es un extra: si algo inesperado falla, el drawer abre igual.
    console.error("[medicion] fallo la medicion de la pieza:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function measure(
  supabase: Db,
  params: { workspaceId: string; pieceId: string; now?: Date },
): Promise<PiecePerformance | null> {
  const now = params.now ?? new Date();

  const { data: rows, error } = await supabase
    .from("social_posts")
    .select("id, platform, media_type, published_at, engagement_d7")
    .eq("workspace_id", params.workspaceId)
    .eq("content_post_id", params.pieceId)
    .is("deleted_at", null)
    .not("published_at", "is", null);

  if (error) {
    console.error("[medicion] no pude leer las publicaciones de la pieza:", error.message);
    return null;
  }
  if (!rows || rows.length === 0) return null;

  const ids = rows.map((r) => r.id);
  const platforms = [...new Set(rows.map((r) => r.platform as string))];
  const times = rows.map((r) => new Date(r.published_at as string).getTime());
  // Lo normal de cada publicacion son los 90 dias ANTERIORES a ella: la ventana
  // arranca 90 dias antes de la mas vieja y termina en la mas nueva.
  const from = new Date(Math.min(...times) - INDEX_WINDOW_DAYS * 86_400_000).toISOString();
  const to = new Date(Math.max(...times)).toISOString();

  const [dailyRes, peersRes, leads] = await Promise.all([
    supabase
      .from("social_post_metrics_daily")
      .select("social_post_id, date, views, reach, likes, comments, shares, saves")
      .eq("workspace_id", params.workspaceId)
      .in("social_post_id", ids),
    supabase
      .from("social_posts")
      .select("id, platform, media_type, published_at, engagement_d7")
      .eq("workspace_id", params.workspaceId)
      .in("platform", platforms as never[])
      .is("deleted_at", null)
      .not("published_at", "is", null)
      .not("engagement_d7", "is", null)
      .gte("published_at", from)
      .lte("published_at", to)
      .limit(PEERS_LIMIT),
    readLeads(supabase, { pieceId: params.pieceId, publicationIds: ids }),
  ]);

  if (dailyRes.error) {
    console.error("[medicion] no pude leer las fotos diarias de la pieza:", dailyRes.error.message);
  }
  if (peersRes.error) {
    console.error("[medicion] no pude leer las publicaciones para el indice:", peersRes.error.message);
  } else if ((peersRes.data ?? []).length >= PEERS_LIMIT) {
    console.error("[medicion] el indice se calculo con el tope de comparables: puede quedar corto.");
  }

  const snapshotsByPost = new Map<string, Snapshot[]>();
  for (const row of dailyRes.data ?? []) {
    const list = snapshotsByPost.get(row.social_post_id) ?? [];
    list.push({
      date: row.date,
      views: row.views,
      reach: row.reach,
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
      saves: row.saves,
    });
    snapshotsByPost.set(row.social_post_id, list);
  }

  const publications: PerformancePublication[] = rows.map((row) => ({
    socialPostId: row.id,
    platform: row.platform as string,
    mediaType: row.media_type,
    publishedAt: row.published_at,
    engagementD7: row.engagement_d7,
    snapshots: snapshotsByPost.get(row.id) ?? [],
  }));

  const population: IndexPublication[] = (peersRes.data ?? []).map((row) => ({
    socialPostId: row.id,
    platform: row.platform as string,
    mediaType: row.media_type,
    publishedAt: row.published_at,
    engagementD7: row.engagement_d7,
  }));

  return buildPiecePerformance({ publications, population, leads, now });
}
