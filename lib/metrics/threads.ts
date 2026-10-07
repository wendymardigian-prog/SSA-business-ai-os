/**
 * Lector de metricas de Threads (F44).
 *
 * Portado de un sistema anterior, con un cambio de criterio: ahi un metric que no venia
 * quedaba en cero; aca queda en `null`. Un cero escrito en la tabla se lee
 * despues como "ese dia no hubo vistas", y eso no es lo que Threads dijo.
 *
 * La API vive en `graph.threads.net`, no en la Graph de Facebook, y usa el
 * mismo token de la conexion de Threads (F12).
 */

import {
  EMPTY_POST_METRICS,
  num,
  type AccountSnapshot,
  type PostMetrics,
  type PostSnapshot,
  type ReaderResult,
} from "./types";

export const THREADS_API = "https://graph.threads.net/v1.0";

/** Lo que Threads sabe medir de un post. */
export const POST_METRICS = "views,likes,replies,reposts,quotes" as const;

/** Lo que sabe medir de una cuenta. */
export const ACCOUNT_METRICS = "views,likes,replies,reposts,quotes,followers_count" as const;

interface InsightEntry {
  name?: string;
  values?: Array<{ value?: unknown }>;
  total_value?: { value?: unknown };
}

/** El total de un metric. Null si no vino. */
export function insightTotal(entry: InsightEntry | undefined): number | null {
  if (!entry) return null;
  if (typeof entry.total_value?.value === "number") return entry.total_value.value;
  const values = (entry.values ?? []).filter((v) => typeof v?.value === "number");
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + (v.value as number), 0);
}

/** Las metricas de un post de Threads, a la forma comun. */
export function normalizeThreadsMetrics(payload: unknown): PostMetrics {
  const data = (payload as { data?: InsightEntry[] } | null)?.data;
  if (!Array.isArray(data)) return { ...EMPTY_POST_METRICS };

  const by = (name: string) => insightTotal(data.find((e) => e.name === name));

  const views = by("views");
  const likes = by("likes");
  const replies = by("replies");
  const reposts = by("reposts");
  const quotes = by("quotes");

  const interactions = [likes, replies, reposts, quotes].filter(
    (v): v is number => typeof v === "number",
  );

  return {
    views,
    // Threads no distingue impresiones de vistas: dejar impressions en null
    // es mas honesto que copiar el mismo numero en dos columnas.
    impressions: null,
    reach: null,
    likes,
    comments: replies,
    // Compartir en Threads es repostear o citar: las dos son amplificacion.
    shares:
      reposts === null && quotes === null ? null : (reposts ?? 0) + (quotes ?? 0),
    saves: null,
    watchTimeSeconds: null,
    avgViewDurationSeconds: null,
    engagementRate:
      interactions.length > 0 && views !== null && views > 0
        ? Number(((interactions.reduce((a, b) => a + b, 0) / views) * 100).toFixed(2))
        : null,
    extra: {
      ...(reposts !== null ? { reposts } : {}),
      ...(quotes !== null ? { quotes } : {}),
    },
  };
}

interface ThreadsPost {
  id?: string;
  permalink?: string;
  text?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp?: string;
}

/** El tipo de media de Threads, en nuestro vocabulario. */
export function threadsMediaType(mediaType: string | undefined): string | null {
  switch (mediaType) {
    case "IMAGE":
      return "image";
    case "VIDEO":
      return "video";
    case "CAROUSEL_ALBUM":
      return "carousel";
    case "TEXT_POST":
      return "text";
    default:
      return null;
  }
}

async function get<T>(
  path: string,
  token: string,
  params: Record<string, string | number>,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const url = new URL(`${THREADS_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", token);

  try {
    const res = await fetchImpl(url.toString());
    const body = (await res.json()) as T & { error?: { message?: string } };
    if (body?.error) return { ok: false, error: body.error.message ?? "Threads rechazo el pedido" };
    if (!res.ok) return { ok: false, error: `Threads respondio ${res.status}` };
    return { ok: true, data: body as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ThreadsReaderParams {
  token: string;
  /** El id del usuario de Threads. */
  userId: string;
  since?: string;
  fetchImpl?: typeof fetch;
  /** Cuantos posts como maximo. */
  limit?: number;
}

/**
 * Trae los posts de la cuenta con sus metricas.
 *
 * Una llamada por post para los insights: Threads no tiene un endpoint que
 * los traiga todos juntos. Por eso el tope de posts importa, y por eso la
 * regla de frecuencia de F45 vale doble aca.
 */
export async function readThreadsMetrics(params: ThreadsReaderParams): Promise<ReaderResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const posts: PostSnapshot[] = [];
  const accountDaily: AccountSnapshot[] = [];

  const list = await get<{ data?: ThreadsPost[] }>(
    `/${params.userId}/threads`,
    params.token,
    {
      fields: "id,permalink,text,media_type,media_url,thumbnail_url,timestamp",
      limit: params.limit ?? 50,
      ...(params.since ? { since: params.since } : {}),
    },
    fetchImpl,
  );

  if (!list.ok) {
    warnings.push(`Threads: ${list.error}`);
  } else {
    for (const post of list.data.data ?? []) {
      if (!post.id) continue;

      const insights = await get<unknown>(
        `/${post.id}/insights`,
        params.token,
        { metric: POST_METRICS },
        fetchImpl,
      );

      posts.push({
        platform: "threads",
        externalPostId: post.id,
        publisherRef: null,
        url: post.permalink ?? null,
        caption: post.text ?? null,
        mediaType: threadsMediaType(post.media_type),
        thumbnailUrl: post.thumbnail_url ?? post.media_url ?? null,
        publishedAt: post.timestamp ?? null,
        // Un post cuyos insights fallaron entra igual, con todo en null: la
        // fila de la publicacion sirve aunque los numeros no esten.
        metrics: insights.ok ? normalizeThreadsMetrics(insights.data) : { ...EMPTY_POST_METRICS },
      });
    }
  }

  const followers = await get<{ data?: InsightEntry[] }>(
    `/${params.userId}/threads_insights`,
    params.token,
    { metric: "followers_count" },
    fetchImpl,
  );

  if (followers.ok) {
    const count = insightTotal((followers.data.data ?? []).find((e) => e.name === "followers_count"));
    if (count !== null) {
      accountDaily.push({
        date: "",
        followers: num(count),
        followersGained: null,
        followersLost: null,
        impressions: null,
        reach: null,
        profileViews: null,
        extra: {},
      });
    }
  } else {
    warnings.push(`Threads (seguidores): ${followers.error}`);
  }

  return { posts, accountDaily, warnings };
}
