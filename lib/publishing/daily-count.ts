/**
 * Cuántas publicaciones ya hay en un día, para el tope diario (F77).
 *
 * `publishedToday` existía en la validación y nadie lo llenaba: el tope diario
 * de cada red no se calculaba nunca. Esto lo llena con lo que ya salió ese
 * día más lo que está agendado para ese día.
 *
 * "Ese día" es el día en la zona del workspace, no en UTC: una publicación a
 * las 22:00 de Costa Rica ya es del día siguiente en UTC, y contarla ahí
 * dejaría pasar de más (o de menos) justo a la noche, cuando más se programa.
 *
 * Se leen filas en una ventana de ±36 h alrededor del instante y se filtran
 * acá por el día local. Es más simple que calcular los límites del día en UTC
 * a mano, y no se rompe con el cambio de horario de verano.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SocialPlatform } from "@/lib/types/database";
import { dailyKindOf } from "@/lib/content/media-type";
import { workspaceDate } from "@/lib/metrics/rules";

type Db = SupabaseClient<Database>;

export interface DayCount {
  total: number;
  video: number;
  image: number;
}

/** Estados que ya ocuparon (o van a ocupar) un lugar del día. */
const SCHEDULED_STATES = ["scheduled", "uploading", "publishing"] as const;
const WINDOW_MS = 36 * 60 * 60 * 1000;

export async function countPublicationsForDay(
  service: Db,
  params: {
    workspaceId: string;
    platform: string;
    /** El instante del que se quiere saber qué día es. */
    at: Date;
    /** La zona del workspace. */
    timeZone: string;
    /** La pieza que se está programando: reprogramarla no cuenta contra sí misma. */
    excludePostId?: string;
  },
): Promise<DayCount> {
  const from = new Date(params.at.getTime() - WINDOW_MS).toISOString();
  const to = new Date(params.at.getTime() + WINDOW_MS).toISOString();
  const day = workspaceDate(params.at, params.timeZone);

  const base = () =>
    service
      .from("social_posts")
      .select("id, content_post_id, status, media_type, scheduled_at, published_at")
      .eq("workspace_id", params.workspaceId)
      .eq("platform", params.platform as SocialPlatform)
      .is("deleted_at", null);

  const [published, scheduled] = await Promise.all([
    base().gte("published_at", from).lte("published_at", to),
    base().in("status", [...SCHEDULED_STATES]).gte("scheduled_at", from).lte("scheduled_at", to),
  ]);

  if (published.error) console.error("[tope diario] no pude leer lo publicado:", published.error.message);
  if (scheduled.error) console.error("[tope diario] no pude leer lo agendado:", scheduled.error.message);

  const count: DayCount = { total: 0, video: 0, image: 0 };
  const seen = new Set<string>();

  const add = (
    row: { id: string; content_post_id: string | null; media_type: string | null },
    instant: string | null,
  ) => {
    if (!instant || seen.has(row.id)) return;
    if (params.excludePostId && row.content_post_id === params.excludePostId) return;
    if (workspaceDate(new Date(instant), params.timeZone) !== day) return;
    seen.add(row.id);
    count.total += 1;
    const kind = dailyKindOf(row.media_type);
    if (kind) count[kind] += 1;
  };

  for (const row of published.data ?? []) {
    // Las externas (publicadas a mano en la red) tienen status null y gastan
    // el tope igual que las nuestras. Lo fallido y lo cancelado no salio.
    if (row.status !== "failed" && row.status !== "cancelled") add(row, row.published_at);
  }
  for (const row of scheduled.data ?? []) add(row, row.scheduled_at);

  return count;
}
