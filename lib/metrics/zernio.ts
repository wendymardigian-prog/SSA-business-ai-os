/**
 * Lector de metricas de Zernio: Instagram y TikTok (F42).
 *
 * **Verificado contra el SDK instalado** (`@zernio/node` 0.2.x), y ahi hay
 * una diferencia con el plano que vale la pena anotar: no existe
 * `GET /v1/analytics/delta` ni un cursor. Lo que hay es `getAnalytics` con
 * `fromDate`/`toDate`, paginado. Gana la documentacion: se pide una ventana
 * de dias en vez de un delta, que para lo que necesitamos (los ultimos 30
 * dias, una vez por noche) da lo mismo y es mas simple de razonar.
 *
 * `source: "all"` trae tambien lo publicado a mano desde la app de la red.
 * Eso es a proposito: esos posts entran como `external` y aparecen en las
 * metricas aunque no hayan salido de este sistema. Un dashboard que solo
 * cuenta lo que publicamos nosotros no sirve para decidir nada.
 *
 * El lector NO escribe: devuelve lo leido normalizado. Guardar es de
 * `lib/metrics/sync.ts`.
 */

import { createZernioClient } from "@/lib/zernio-client";
import {
  EMPTY_POST_METRICS,
  msToSeconds,
  num,
  positive,
  type AccountSnapshot,
  type PostMetrics,
  type PostSnapshot,
  type ReaderResult,
} from "./types";

/** Las redes que Zernio sabe leer en esta etapa. */
export const ZERNIO_PLATFORMS = ["instagram", "tiktok"] as const;

/** Cuantas paginas se piden como maximo. */
const MAX_PAGES = 20;
const PAGE_SIZE = 50;

interface ZernioPost {
  _id?: string;
  latePostId?: string | null;
  content?: string;
  publishedAt?: string;
  platform?: string;
  platformPostUrl?: string;
  thumbnailUrl?: string;
  mediaType?: string;
  isExternal?: boolean;
  analytics?: Record<string, unknown> | null;
  platforms?: Array<{
    platform?: string;
    platformPostId?: string | null;
    platformPostUrl?: string | null;
    analytics?: Record<string, unknown> | null;
  }>;
}

/**
 * Normaliza las metricas de un post.
 *
 * `igReelsAvgWatchTime` y `igReelsVideoViewTotalTime` vienen en
 * milisegundos: se guardan en segundos, que es la unidad de la tabla.
 */
export function normalizePostMetrics(raw: Record<string, unknown> | null | undefined): PostMetrics {
  if (!raw) return { ...EMPTY_POST_METRICS };

  const total = msToSeconds(raw.igReelsVideoViewTotalTime);
  const avg = msToSeconds(raw.igReelsAvgWatchTime);

  return {
    views: num(raw.views),
    impressions: num(raw.impressions),
    reach: num(raw.reach),
    likes: num(raw.likes),
    comments: num(raw.comments),
    shares: num(raw.shares),
    saves: num(raw.saves),
    watchTimeSeconds: total,
    avgViewDurationSeconds: avg,
    engagementRate: num(raw.engagementRate),
    extra: {
      // `follows` es de las metricas mas utiles de Instagram y no tiene
      // columna propia porque ninguna otra red la da.
      ...(num(raw.follows) !== null ? { follows: num(raw.follows) } : {}),
      ...(num(raw.clicks) !== null ? { clicks: num(raw.clicks) } : {}),
      ...(positive(raw.videoDurationSeconds) !== null
        ? { video_duration_seconds: positive(raw.videoDurationSeconds) }
        : {}),
    },
  };
}

/**
 * El tipo de media, en nuestro vocabulario.
 *
 * Zernio dice `image | video | gif | document | carousel | text`. Nuestro
 * CHECK admite ademas `reel`, `story` y `short`, que Zernio no distingue: eso
 * lo completa quien publico, y para los externos queda el tipo general.
 */
export function mediaTypeOf(zernioType: string | undefined): string | null {
  switch (zernioType) {
    case "carousel":
      return "carousel";
    case "video":
      return "video";
    case "image":
    case "gif":
      return "image";
    case "document":
      return "document";
    case "text":
      return "text";
    default:
      return null;
  }
}

/**
 * Un post de Zernio a nuestra forma.
 *
 * El `externalPostId` sale de `platforms[].platformPostId`, que es el id EN
 * LA RED: es la unica clave que sirve para cruzar un post publicado por
 * nosotros con el mismo post leido de la API. `_id` es de Zernio y no existe
 * para los publicados a mano.
 */
export function toSnapshot(post: ZernioPost, platform: string): PostSnapshot | null {
  const entry = post.platforms?.find((p) => p.platform === platform) ?? post.platforms?.[0];
  const externalPostId = entry?.platformPostId ?? null;

  // Sin id en la red no hay con que cruzarlo ni a que volver: se saltea.
  if (!externalPostId) return null;

  return {
    platform,
    externalPostId,
    publisherRef: post._id ?? null,
    url: entry?.platformPostUrl ?? post.platformPostUrl ?? null,
    caption: post.content ?? null,
    mediaType: mediaTypeOf(post.mediaType),
    thumbnailUrl: post.thumbnailUrl ?? null,
    publishedAt: post.publishedAt ?? null,
    metrics: normalizePostMetrics(entry?.analytics ?? post.analytics),
  };
}

export interface ZernioReaderParams {
  apiKey: string;
  /** El id de la cuenta EN ZERNIO (`late_account_id`). */
  accountId: string;
  platform: string;
  /** Desde que dia se piden los posts (YYYY-MM-DD). */
  fromDate: string;
  toDate?: string;
  /** Para los tests. */
  client?: ReturnType<typeof createZernioClient>;
}

/**
 * Trae los posts de una cuenta con sus metricas.
 *
 * Los seguidores vienen en `accounts[].followerCount`, que es un solo numero
 * sin historia: se guarda como el valor de HOY. La serie se arma con los dias
 * que se fueron guardando, no con un historial que Zernio no da (F45 lo
 * anota).
 */
export async function readZernioMetrics(params: ZernioReaderParams): Promise<ReaderResult> {
  const client = params.client ?? createZernioClient(params.apiKey);
  const posts: PostSnapshot[] = [];
  const warnings: string[] = [];
  const accountDaily: AccountSnapshot[] = [];

  let followerCount: number | null = null;
  let analyticsAvailable = true;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await client.analytics.getAnalytics({
      query: {
        accountId: params.accountId,
        platform: params.platform,
        fromDate: params.fromDate,
        ...(params.toDate ? { toDate: params.toDate } : {}),
        // Tambien lo publicado a mano: un dashboard que solo cuenta lo
        // nuestro no sirve para decidir nada.
        source: "all",
        limit: PAGE_SIZE,
        page,
        order: "desc",
      },
    });

    if (response.error) {
      warnings.push(errorMessage(response.error));
      break;
    }

    const data = response.data as
      | {
          posts?: ZernioPost[];
          pagination?: { page?: number; totalPages?: number };
          accounts?: Array<{ _id?: string; followerCount?: number }>;
          hasAnalyticsAccess?: boolean;
        }
      | undefined;

    if (data?.hasAnalyticsAccess === false) {
      analyticsAvailable = false;
      warnings.push("El plan de Zernio no incluye analitica: no hay metricas para traer.");
      break;
    }

    for (const post of data?.posts ?? []) {
      const snapshot = toSnapshot(post, params.platform);
      if (snapshot) posts.push(snapshot);
    }

    if (followerCount === null) {
      const account = (data?.accounts ?? []).find((a) => a._id === params.accountId);
      followerCount = num(account?.followerCount);
    }

    const pagination = data?.pagination;
    if (!pagination?.totalPages || page >= pagination.totalPages) break;
  }

  // Las cifras del perfil que no son una serie (seguidos, publicaciones, me
  // gusta, videos, vistas). Solo se piden si el plan tiene analitica, y un fallo
  // aca no tumba la lectura de los posts: son un dato de adorno, no de decision.
  const profile = analyticsAvailable ? await readProfileStats(client, params.accountId) : null;

  if (followerCount !== null || profile) {
    accountDaily.push({
      // El dia lo pone quien guarda, en la zona del workspace: el lector no
      // sabe en que zona vive quien mira el dashboard.
      date: "",
      followers: followerCount,
      followersGained: null,
      followersLost: null,
      impressions: null,
      reach: null,
      profileViews: null,
      extra: profile ? { profile } : {},
    });
  }

  return { posts, accountDaily, warnings };
}

/** Lo que Zernio guarda del perfil de la cuenta, y que se muestra en Social (F75). */
const PROFILE_KEYS = [
  ["followingCount", "following"],
  ["mediaCount", "posts"],
  ["videoCount", "videos"],
  ["totalViews", "views"],
  ["likesCount", "likes"],
] as const;

/**
 * Las cifras de perfil de una cuenta. Devuelve null si no hay ninguna: un campo
 * que la red no dio no se escribe, porque un cero se lee despues como "no
 * tiene" y es una afirmacion distinta y falsa.
 */
async function readProfileStats(
  client: ReturnType<typeof createZernioClient>,
  accountId: string,
): Promise<Record<string, number> | null> {
  try {
    const getStats = client.accounts?.getFollowerStats;
    if (typeof getStats !== "function") return null;

    const response = await getStats.call(client.accounts, { query: { accountIds: accountId } });
    if (response.error) return null;

    const accounts: Array<{ _id?: string; accountStats?: Record<string, unknown> }> =
      response.data?.accounts ?? [];
    const stats = accounts.find((a) => a._id === accountId)?.accountStats;
    if (!stats) return null;

    const out: Record<string, number> = {};
    for (const [from, to] of PROFILE_KEYS) {
      const value = num(stats[from]);
      if (value !== null) out[to] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch (err) {
    console.error("[metricas] no pude leer las cifras de perfil:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "error" in error) {
    const message = (error as { error?: unknown }).error;
    if (typeof message === "string" && message) return `Zernio: ${message}`;
  }
  return "Zernio no devolvio las metricas";
}
