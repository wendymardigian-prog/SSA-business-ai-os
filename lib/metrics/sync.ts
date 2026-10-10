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
import { computeD7, shouldCollect, workspaceDate, type DailyPoint, type StoredPost } from "./rules";
import type { AccountProfile, AccountSnapshot, PostMetrics, PostSnapshot } from "./types";
import { findManualMatch } from "./adopt-manual";

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

type ExistingRow = {
  id: string;
  origin: "system" | "external" | "manual";
  published_at: string | null;
  d7_computed_at: string | null;
  content_post_id: string | null;
};

/**
 * Si este post es una publicacion marcada a mano, la deja vinculada.
 *
 * Dos casos:
 *  - No habia ninguna fila con ese id: la fila manual RECIBE el id de la red
 *    (`external_post_id`) y su cuenta. Es la misma fila: la pieza, el
 *    calendario y el rendimiento siguen apuntando ahi.
 *  - Ya habia una fila suelta (`external`, sin pieza) para ese post, porque
 *    llego un comentario antes que la sincronizacion: esa fila ya tiene el id
 *    y lo que cuelga de ella (comentarios, toques). Se la pasa a la pieza
 *    como publicacion a mano, y la manual (que no tiene nada: sin id no pudo
 *    traer metricas ni comentarios) se borra de forma logica.
 *
 * Nunca lanza: no encontrar la pareja es el caso de siempre.
 */
async function adoptManual(
  supabase: Db,
  params: { workspaceId: string; socialAccountId: string; platform: string },
  post: PostSnapshot,
  existing: ExistingRow | null,
): Promise<ExistingRow | null> {
  try {
    const manualId = await findManualMatch(supabase, {
      workspaceId: params.workspaceId,
      socialAccountId: params.socialAccountId,
      platform: params.platform,
      url: post.url ?? null,
      publishedAt: post.publishedAt ?? null,
    });
    if (!manualId) return existing;

    const { data: manual } = await supabase
      .from("social_posts")
      .select("id, content_post_id, published_at, url")
      .eq("id", manualId)
      .maybeSingle();
    if (!manual) return existing;

    if (!existing) {
      const { error } = await supabase
        .from("social_posts")
        .update({ external_post_id: post.externalPostId, social_account_id: params.socialAccountId })
        .eq("id", manual.id);
      if (error) {
        console.error("[metricas] no pude vincular la publicacion marcada a mano:", error.message);
        return null;
      }
      return {
        id: manual.id,
        origin: "manual",
        published_at: manual.published_at,
        d7_computed_at: null,
        content_post_id: manual.content_post_id,
      };
    }

    // La manual primero: el indice unico (pieza, red) admite una sola viva.
    await supabase.from("social_posts").update({ deleted_at: new Date().toISOString() }).eq("id", manual.id);
    const { error } = await supabase
      .from("social_posts")
      .update({
        content_post_id: manual.content_post_id,
        origin: "manual",
        status: "published",
        ...(manual.url ? { url: manual.url } : {}),
      })
      .eq("id", existing.id);
    if (error) {
      console.error("[metricas] no pude pasar la publicacion a la pieza:", error.message);
      await supabase.from("social_posts").update({ deleted_at: null }).eq("id", manual.id);
      return existing;
    }
    return { ...existing, origin: "manual", content_post_id: manual.content_post_id };
  } catch (err) {
    console.error("[metricas] fallo la busqueda de publicaciones marcadas a mano:", err);
    return existing;
  }
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
    const found = await supabase
      .from("social_posts")
      .select("id, origin, published_at, d7_computed_at, content_post_id")
      .eq("social_account_id", params.socialAccountId)
      .eq("external_post_id", post.externalPostId)
      .maybeSingle();
    let existing = found.data;

    // Un post subido a mano y marcado como publicado (Contenido v4) ya tiene
    // su fila, sin el id de la red. Se completa ESA fila en vez de crear otra.
    if (!existing || (existing.origin === "external" && !existing.content_post_id)) {
      existing = await adoptManual(supabase, params, post, existing);
    }

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

/**
 * Actualiza lo descriptivo (formato, miniatura, texto, link) de publicaciones
 * que la red devolvio pero que hoy no tocaba guardar (F79).
 *
 * La lectura ya estaba hecha: no cuesta cuota. Sin esto, un post viejo
 * quedaba para siempre con lo que se supo la primera vez (un Short importado
 * como "video" no se corregia nunca). Solo actualiza filas que ya existen y
 * no toca `last_synced_at`: la frecuencia de lectura de metricas sigue igual.
 * Nunca lanza.
 */
export async function refreshPostDetails(
  supabase: Db,
  params: { socialAccountId: string; posts: PostSnapshot[] },
): Promise<void> {
  for (const post of params.posts) {
    const descriptive = defined({
      caption: post.caption,
      media_type: post.mediaType as SocialPostMediaType | null,
      thumbnail_url: post.thumbnailUrl,
      url: post.url,
    });
    if (Object.keys(descriptive).length === 0) continue;

    const { error } = await supabase
      .from("social_posts")
      .update(descriptive)
      .eq("social_account_id", params.socialAccountId)
      .eq("external_post_id", post.externalPostId);
    if (error) console.error("[metricas] no pude actualizar los datos de una publicacion:", error.message);
  }
}

/**
 * El perfil de la cuenta (foto, usuario, nombre, bio) segun el lector.
 *
 * Solo lo que la red dio: un campo en null no borra lo que habia. Nunca
 * lanza: una foto que no se pudo guardar no tumba la sincronizacion.
 */
export async function persistAccountProfile(
  supabase: Db,
  params: { socialAccountId: string; profile: AccountProfile },
): Promise<void> {
  const values = defined({
    username: params.profile.username,
    handle: params.profile.username,
    display_name: params.profile.displayName,
    avatar_url: params.profile.avatarUrl,
    bio: params.profile.bio,
    profile_url: params.profile.profileUrl,
  });
  if (Object.keys(values).length === 0) return;

  const { error } = await supabase.from("social_accounts").update(values).eq("id", params.socialAccountId);
  if (error) console.error("[metricas] no pude guardar el perfil de la cuenta:", error.message);
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

/**
 * Los posts que la cuenta ya tiene guardados, para decidir que se vuelve a
 * leer (F79). Si la lectura falla devuelve una lista vacia: sin esto se lee la
 * ventana de siempre, que es lo seguro.
 */
export async function storedPosts(supabase: Db, socialAccountId: string): Promise<StoredPost[]> {
  const { data, error } = await supabase
    .from("social_posts")
    .select("external_post_id, published_at, last_synced_at")
    .eq("social_account_id", socialAccountId)
    .not("external_post_id", "is", null)
    .is("deleted_at", null);

  if (error) {
    console.error("[metricas] no pude leer los posts guardados:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    externalPostId: row.external_post_id as string,
    publishedAt: row.published_at,
    lastSyncedAt: row.last_synced_at,
  }));
}

/** Anota como le fue a una cuenta, para que la card lo muestre. */
export async function markAccountSync(
  supabase: Db,
  params: { socialAccountId: string; now: Date; error?: string | null },
): Promise<void> {
  // Con un error NO se sella `profile_synced_at` (F75): antes se sellaba igual
  // y la card decia "sincronizado" aunque hubiera fallado. El error se guarda
  // en la cuenta para que la pantalla lo muestre, y la fecha del ultimo dato
  // bueno queda como estaba.
  if (params.error) {
    console.error(`[metricas] cuenta ${params.socialAccountId}: ${params.error}`);
    await supabase
      .from("social_accounts")
      .update({ profile_sync_error: params.error.slice(0, 500) })
      .eq("id", params.socialAccountId);
    return;
  }

  await supabase
    .from("social_accounts")
    .update({ profile_synced_at: params.now.toISOString(), profile_sync_error: null })
    .eq("id", params.socialAccountId);
}

/** La fecha de hoy para este workspace. */
export function syncDate(now: Date, timeZone: string | null): string {
  return workspaceDate(now, timeZone || "UTC");
}
