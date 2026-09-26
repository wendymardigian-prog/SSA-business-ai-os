/**
 * Guardar lo que leyeron los lectores, y decidir cuando (F47).
 *
 * Los lectores traen; esto guarda. La separacion importa porque guardar es
 * lo unico que toca la base y lo unico que tiene que ser idempotente: la
 * misma lectura dos veces el mismo dia tiene que dejar una sola fila,
 * corregida.
 *
 * Tres decisiones:
 *
 * 1. **Una fila por dia y objeto, con valores acumulados.** El unico de la
 *    base lo garantiza; aca se hace upsert.
 * 2. **Un metric en null no se escribe.** Si la red no lo dio, la columna
 *    queda como estaba en vez de pisarse con un cero.
 * 3. **Si un lector falla, los otros corren igual.** Una cuenta de LinkedIn
 *    con el token vencido no puede dejar a Instagram sin metricas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SocialPlatform, SocialPostMediaType } from "@/lib/types/database";
import { computeD7, shouldCollect, workspaceDate, type DailyPoint } from "./rules";
import type { AccountSnapshot, PostMetrics, PostSnapshot } from "./types";

type Db = SupabaseClient<Database>;

/** Cada cuanto se puede apretar "Actualizar ahora". */
export const MANUAL_REFRESH_COOLDOWN_MS = 15 * 60 * 1000;

export type RefreshDecision =
  | { allowed: true }
  | { allowed: false; retryInSeconds: number; message: string };

/**
 * Si se puede actualizar a mano ahora.
 *
 * El tope no es capricho: cada actualizacion son decenas de llamadas contra
 * cinco APIs con cuota. Apretar el boton cinco veces seguidas no trae datos
 * mas nuevos, quema la cuota del dia.
 */
export function canRefreshNow(lastSyncedAt: string | null, now: Date): RefreshDecision {
  if (!lastSyncedAt) return { allowed: true };

  const elapsed = now.getTime() - new Date(lastSyncedAt).getTime();
  if (Number.isNaN(elapsed) || elapsed >= MANUAL_REFRESH_COOLDOWN_MS) return { allowed: true };

  const retryInSeconds = Math.ceil((MANUAL_REFRESH_COOLDOWN_MS - elapsed) / 1000);
  const minutes = Math.ceil(retryInSeconds / 60);
  return {
    allowed: false,
    retryInSeconds,
    message: `Ya se actualizo hace poco. Proba de nuevo en ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`,
  };
}

/** Solo las claves con valor: un null no pisa lo que ya estaba. */
function defined<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)) as Partial<T>;
}

export interface PersistResult {
  publications: number;
  metricRows: number;
  created: number;
  warnings: string[];
}

/**
 * Guarda los posts leidos: la publicacion y su fila del dia.
 *
 * Cruza por `(social_account_id, external_post_id)`, que es el unico de la
 * base: un post que publicamos nosotros se ACTUALIZA, no se duplica como
 * externo. Es la diferencia entre ver un post en el tablero y verlo dos
 * veces, una con caption y otra sin.
 */
export async function persistPosts(
  supabase: Db,
  params: {
    workspaceId: string;
    socialAccountId: string;
    platform: string;
    posts: PostSnapshot[];
    date: string;
    now: Date;
  },
): Promise<PersistResult> {
  const warnings: string[] = [];
  let created = 0;
  let metricRows = 0;

  for (const post of params.posts) {
    const { data: existing } = await supabase
      .from("social_posts")
      .select("id, origin, published_at, d7_computed_at")
      .eq("social_account_id", params.socialAccountId)
      .eq("external_post_id", post.externalPostId)
      .maybeSingle();

    let socialPostId = existing?.id ?? null;

    // El lector solo escribe lo que la red sabe: caption, miniatura, tipo y
    // la marca de sincronizacion. El estado de publicacion, el publicador y
    // los errores son nuestros y no se tocan.
    const descriptive = defined({
      caption: post.caption,
      // El CHECK de la base acota los tipos: el lector ya los tradujo, pero
      // un tipo nuevo de la red no puede tumbar la sincronizacion.
      media_type: post.mediaType as SocialPostMediaType | null,
      thumbnail_url: post.thumbnailUrl,
      url: post.url,
      published_at: post.publishedAt,
    });

    if (socialPostId) {
      await supabase
        .from("social_posts")
        .update({ ...descriptive, last_synced_at: params.now.toISOString(), sync_error: null })
        .eq("id", socialPostId);
    } else {
      const { data: inserted, error } = await supabase
        .from("social_posts")
        .insert({
          workspace_id: params.workspaceId,
          social_account_id: params.socialAccountId,
          platform: params.platform as SocialPlatform,
          external_post_id: post.externalPostId,
          publisher_ref: post.publisherRef,
          origin: "external",
          status: null,
          last_synced_at: params.now.toISOString(),
          ...descriptive,
        })
        .select("id")
        .maybeSingle();

      if (error || !inserted) {
        warnings.push(`No pude guardar la publicacion ${post.externalPostId}`);
        continue;
      }
      socialPostId = inserted.id;
      created += 1;
    }

    const wrote = await persistPostMetrics(supabase, {
      workspaceId: params.workspaceId,
      socialPostId,
      date: params.date,
      metrics: post.metrics,
    });
    if (wrote) metricRows += 1;

    // El engagement comparable se congela una sola vez.
    if (!existing?.d7_computed_at) {
      await maybeComputeD7(supabase, {
        socialPostId,
        publishedAt: post.publishedAt ?? existing?.published_at ?? null,
        now: params.now,
      });
    }
  }

  return { publications: params.posts.length, metricRows, created, warnings };
}

/** La fila del dia. Vacia no se escribe: no hay dato que guardar. */
export async function persistPostMetrics(
  supabase: Db,
  params: { workspaceId: string; socialPostId: string; date: string; metrics: PostMetrics },
): Promise<boolean> {
  const values = defined({
    views: params.metrics.views,
    impressions: params.metrics.impressions,
    reach: params.metrics.reach,
    likes: params.metrics.likes,
    comments: params.metrics.comments,
    shares: params.metrics.shares,
    saves: params.metrics.saves,
    watch_time_seconds: params.metrics.watchTimeSeconds,
    avg_view_duration_seconds: params.metrics.avgViewDurationSeconds,
    engagement_rate: params.metrics.engagementRate,
  });

  const hasExtra = Object.keys(params.metrics.extra).length > 0;
  // Ni un numero ni nada en extra: no hubo dato. Una fila vacia se veria en
  // el grafico como un dia en cero, que es justo lo que no queremos.
  if (Object.keys(values).length === 0 && !hasExtra) return false;

  const { error } = await supabase.from("social_post_metrics_daily").upsert(
    {
      workspace_id: params.workspaceId,
      social_post_id: params.socialPostId,
      date: params.date,
      ...values,
      ...(hasExtra ? { extra: params.metrics.extra as never } : {}),
    },
    { onConflict: "social_post_id,date" },
  );

  if (error) {
    console.error("[metricas] no pude guardar la fila del dia:", error.message);
    return false;
  }
  return true;
}

/** La fila diaria de la cuenta. */
export async function persistAccountMetrics(
  supabase: Db,
  params: {
    workspaceId: string;
    socialAccountId: string;
    date: string;
    snapshot: AccountSnapshot;
  },
): Promise<boolean> {
  const values = defined({
    followers: params.snapshot.followers,
    followers_gained: params.snapshot.followersGained,
    followers_lost: params.snapshot.followersLost,
    impressions: params.snapshot.impressions,
    reach: params.snapshot.reach,
    profile_views: params.snapshot.profileViews,
  });

  const hasExtra = Object.keys(params.snapshot.extra).length > 0;
  if (Object.keys(values).length === 0 && !hasExtra) return false;

  const { error } = await supabase.from("social_account_metrics_daily").upsert(
    {
      workspace_id: params.workspaceId,
      social_account_id: params.socialAccountId,
      // La fecha del snapshot cuando la trae (una serie historica), y si no
      // la de hoy: los lectores que dan un solo numero no saben de que dia es.
      date: params.snapshot.date || params.date,
      ...values,
      ...(hasExtra ? { extra: params.snapshot.extra as never } : {}),
    },
    { onConflict: "social_account_id,date" },
  );

  if (error) {
    console.error("[metricas] no pude guardar la fila de la cuenta:", error.message);
    return false;
  }
  return true;
}

/**
 * Congela el engagement a 7 dias si ya corresponde.
 *
 * Lee las filas diarias que ya estan guardadas: el numero sale de lo que se
 * fue recolectando, no de una llamada nueva a la red.
 */
export async function maybeComputeD7(
  supabase: Db,
  params: { socialPostId: string; publishedAt: string | null; now: Date },
): Promise<boolean> {
  if (!params.publishedAt) return false;

  const { data: daily } = await supabase
    .from("social_post_metrics_daily")
    .select("date, views, reach, likes, comments, shares, saves")
    .eq("social_post_id", params.socialPostId)
    .order("date");

  const result = computeD7({
    publishedAt: params.publishedAt,
    daily: (daily ?? []) as DailyPoint[],
    now: params.now,
  });
  if (!result) return false;

  const { error } = await supabase
    .from("social_posts")
    .update({
      engagement_d7: result.engagement,
      interactions_d7: result.interactions,
      reach_d7: result.reach,
      views_d7: result.views,
      d7_computed_at: result.computedAt,
    })
    .eq("id", params.socialPostId);

  return !error;
}

/**
 * Los posts de una cuenta que toca actualizar hoy.
 *
 * Aplica la regla de frecuencia de F45 sobre lo que ya esta guardado, para
 * no pedirle a la red los mil posts historicos cada noche.
 */
export async function postsDueForSync(
  supabase: Db,
  params: { socialAccountId: string; now: Date },
): Promise<Array<{ id: string; externalPostId: string; publishedAt: string | null }>> {
  const { data } = await supabase
    .from("social_posts")
    .select("id, external_post_id, published_at, last_synced_at")
    .eq("social_account_id", params.socialAccountId)
    .not("external_post_id", "is", null)
    .is("deleted_at", null);

  return (data ?? [])
    .filter((row) =>
      shouldCollect({
        publishedAt: row.published_at,
        lastSyncedAt: row.last_synced_at,
        now: params.now,
      }),
    )
    .map((row) => ({
      id: row.id,
      externalPostId: row.external_post_id as string,
      publishedAt: row.published_at,
    }));
}

/** Anota como le fue a una cuenta, para que la card lo muestre. */
export async function markAccountSync(
  supabase: Db,
  params: { socialAccountId: string; now: Date; error?: string | null },
): Promise<void> {
  await supabase
    .from("social_accounts")
    .update({ profile_synced_at: params.now.toISOString() })
    .eq("id", params.socialAccountId);

  if (params.error) {
    // El error va en las publicaciones que no se pudieron leer, no en la
    // cuenta: la cuenta esta bien, lo que fallo fue una lectura.
    console.error(`[metricas] cuenta ${params.socialAccountId}: ${params.error}`);
  }
}

/** La fecha de hoy para este workspace. */
export function syncDate(now: Date, timeZone: string | null): string {
  return workspaceDate(now, timeZone || "America/Costa_Rica");
}
