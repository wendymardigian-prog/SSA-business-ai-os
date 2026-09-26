/**
 * Lector de metricas de YouTube (F44).
 *
 * Dos APIs distintas, y hace falta las dos:
 *
 *  - **Data API v3**: que videos hay, como se llaman, cuantos suscriptores
 *    tiene el canal. Es el catalogo.
 *  - **Analytics API v2** (`reports.query`): cuantas vistas tuvo cada video
 *    CADA DIA. La Data API solo da el total de siempre, y con eso no se
 *    puede hacer una serie.
 *
 * La cuota manda: 10.000 unidades por dia, y una subida de video se lleva
 * 1.600. Por eso la regla de frecuencia (F45) no es una optimizacion, es lo
 * que permite que publicar y medir convivan en el mismo dia.
 */

import {
  EMPTY_POST_METRICS,
  num,
  type AccountSnapshot,
  type PostMetrics,
  type PostSnapshot,
  type ReaderResult,
} from "./types";

export const DATA_API = "https://www.googleapis.com/youtube/v3";
export const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2";

/** Lo que se le pide a la Analytics API por video y dia. */
export const VIDEO_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
] as const;

/** Un Short: vertical y corto, o marcado como tal. */
export const SHORT_MAX_SECONDS = 180;

/**
 * Si el video es un Short.
 *
 * `creatorContentType` es lo que dice YouTube y manda cuando viene. Cuando
 * no, se deduce: vertical y de hasta tres minutos. Es la misma regla que usa
 * YouTube para decidirlo, y importa porque los Shorts y los videos largos no
 * se comparan entre si.
 */
export function isShort(params: {
  creatorContentType?: string | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
}): boolean {
  if (params.creatorContentType) {
    return params.creatorContentType.toUpperCase() === "SHORTS";
  }
  const vertical =
    typeof params.width === "number" &&
    typeof params.height === "number" &&
    params.height > params.width;
  const short = typeof params.durationSeconds === "number" && params.durationSeconds <= SHORT_MAX_SECONDS;
  return vertical && short;
}

/** `PT1M30S` a segundos. Null si no se entiende. */
export function parseIsoDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!match) return null;
  const [, d, h, m, s] = match;
  const total =
    Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  return Number.isFinite(total) ? Math.round(total) : null;
}

/** El tipo de media de un video, en nuestro vocabulario. */
export function youtubeMediaType(params: Parameters<typeof isShort>[0]): "short" | "video" {
  return isShort(params) ? "short" : "video";
}

/**
 * Una fila de `reports.query` a nuestras metricas.
 *
 * La respuesta viene como columnas y filas, estilo planilla: `columnHeaders`
 * dice que es cada posicion. Se arma el mapa una vez y se lee por nombre,
 * porque el orden de las columnas no esta garantizado.
 */
export function rowToMetrics(headers: string[], row: unknown[]): PostMetrics {
  const at = (name: string): number | null => {
    const index = headers.indexOf(name);
    return index >= 0 ? num(row[index]) : null;
  };

  const minutes = at("estimatedMinutesWatched");
  const views = at("views");
  const likes = at("likes");
  const comments = at("comments");
  const shares = at("shares");

  const interactions = [likes, comments, shares].filter((v): v is number => typeof v === "number");

  return {
    views,
    impressions: null,
    reach: null,
    likes,
    comments,
    shares,
    saves: null,
    watchTimeSeconds: minutes === null ? null : Math.round(minutes * 60),
    avgViewDurationSeconds: at("averageViewDuration"),
    engagementRate:
      interactions.length > 0 && views !== null && views > 0
        ? Number(((interactions.reduce((a, b) => a + b, 0) / views) * 100).toFixed(2))
        : null,
    extra: {
      ...(at("subscribersGained") !== null ? { subscribers_gained: at("subscribersGained") } : {}),
    },
  };
}

interface ReportResponse {
  columnHeaders?: Array<{ name?: string }>;
  rows?: unknown[][];
  error?: { message?: string; code?: number };
}

async function apiGet<T>(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as T & { error?: { message?: string } };
    if (body?.error) {
      return { ok: false, error: body.error.message ?? "YouTube rechazo el pedido", status: res.status };
    }
    if (!res.ok) return { ok: false, error: `YouTube respondio ${res.status}`, status: res.status };
    return { ok: true, data: body as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: 0 };
  }
}

export interface YouTubeReaderParams {
  token: string;
  /** El canal. `channels.list?mine=true` lo resuelve si no se sabe. */
  channelId: string;
  startDate: string;
  endDate: string;
  fetchImpl?: typeof fetch;
  /** Cuantos videos como maximo. */
  limit?: number;
}

/**
 * Trae los videos del canal y sus metricas por dia.
 *
 * Una sola llamada a Analytics para TODOS los videos: `dimensions=video,day`
 * con un filtro por la lista de ids. Una llamada por video multiplicaria la
 * cuota por el tamaño del canal.
 */
export async function readYouTubeMetrics(params: YouTubeReaderParams): Promise<ReaderResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const posts: PostSnapshot[] = [];
  const accountDaily: AccountSnapshot[] = [];

  // 1. El canal: suscriptores y la lista de subidas.
  const channel = await apiGet<{
    items?: Array<{
      statistics?: { subscriberCount?: string; viewCount?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
  }>(
    `${DATA_API}/channels?part=statistics,contentDetails&id=${encodeURIComponent(params.channelId)}`,
    params.token,
    fetchImpl,
  );

  let uploadsPlaylist: string | null = null;

  if (!channel.ok) {
    warnings.push(`YouTube (canal): ${channel.error}`);
  } else {
    const item = channel.data.items?.[0];
    uploadsPlaylist = item?.contentDetails?.relatedPlaylists?.uploads ?? null;
    const subscribers = Number(item?.statistics?.subscriberCount);
    if (Number.isFinite(subscribers)) {
      accountDaily.push({
        date: "",
        followers: subscribers,
        followersGained: null,
        followersLost: null,
        impressions: null,
        reach: null,
        profileViews: null,
        extra: {},
      });
    }
  }

  // 2. Los videos de la lista de subidas.
  const videoIds: string[] = [];
  if (uploadsPlaylist) {
    const playlist = await apiGet<{
      items?: Array<{ contentDetails?: { videoId?: string } }>;
    }>(
      `${DATA_API}/playlistItems?part=contentDetails&maxResults=${params.limit ?? 50}` +
        `&playlistId=${encodeURIComponent(uploadsPlaylist)}`,
      params.token,
      fetchImpl,
    );
    if (playlist.ok) {
      for (const item of playlist.data.items ?? []) {
        if (item.contentDetails?.videoId) videoIds.push(item.contentDetails.videoId);
      }
    } else {
      warnings.push(`YouTube (videos): ${playlist.error}`);
    }
  }

  // 3. Los datos de cada video, en un solo pedido.
  const details = new Map<
    string,
    { title: string | null; publishedAt: string | null; thumbnail: string | null; mediaType: string }
  >();

  if (videoIds.length > 0) {
    const videos = await apiGet<{
      items?: Array<{
        id?: string;
        snippet?: { title?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> };
        contentDetails?: { duration?: string };
        fileDetails?: { videoStreams?: Array<{ widthPixels?: number; heightPixels?: number }> };
      }>;
    }>(
      `${DATA_API}/videos?part=snippet,contentDetails&id=${videoIds.join(",")}`,
      params.token,
      fetchImpl,
    );

    if (videos.ok) {
      for (const video of videos.data.items ?? []) {
        if (!video.id) continue;
        const duration = parseIsoDuration(video.contentDetails?.duration);
        const stream = video.fileDetails?.videoStreams?.[0];
        details.set(video.id, {
          title: video.snippet?.title ?? null,
          publishedAt: video.snippet?.publishedAt ?? null,
          thumbnail:
            video.snippet?.thumbnails?.high?.url ?? video.snippet?.thumbnails?.default?.url ?? null,
          mediaType: youtubeMediaType({
            durationSeconds: duration,
            width: stream?.widthPixels ?? null,
            height: stream?.heightPixels ?? null,
          }),
        });
      }
    } else {
      warnings.push(`YouTube (detalle): ${videos.error}`);
    }
  }

  // 4. Las metricas, en UNA llamada para todos los videos.
  const metricsByVideo = new Map<string, PostMetrics>();
  if (videoIds.length > 0) {
    const report = await apiGet<ReportResponse>(
      `${ANALYTICS_API}/reports?ids=channel==${encodeURIComponent(params.channelId)}` +
        `&startDate=${params.startDate}&endDate=${params.endDate}` +
        `&metrics=${VIDEO_METRICS.join(",")}&dimensions=video` +
        `&filters=video==${videoIds.join(",")}&maxResults=200`,
      params.token,
      fetchImpl,
    );

    if (report.ok) {
      const headers = (report.data.columnHeaders ?? []).map((h) => h.name ?? "");
      const videoIndex = headers.indexOf("video");
      for (const row of report.data.rows ?? []) {
        const id = videoIndex >= 0 ? String(row[videoIndex]) : null;
        if (id) metricsByVideo.set(id, rowToMetrics(headers, row));
      }
    } else {
      warnings.push(`YouTube (metricas): ${report.error}`);
    }
  }

  for (const id of videoIds) {
    const detail = details.get(id);
    posts.push({
      platform: "youtube",
      externalPostId: id,
      publisherRef: null,
      url: `https://www.youtube.com/watch?v=${id}`,
      caption: detail?.title ?? null,
      mediaType: detail?.mediaType ?? null,
      thumbnailUrl: detail?.thumbnail ?? null,
      publishedAt: detail?.publishedAt ?? null,
      metrics: metricsByVideo.get(id) ?? { ...EMPTY_POST_METRICS },
    });
  }

  return { posts, accountDaily, warnings };
}
