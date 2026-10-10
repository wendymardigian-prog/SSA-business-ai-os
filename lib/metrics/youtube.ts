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
  type AccountProfile,
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
  // Cuadrado tambien cuenta: YouTube acepta Shorts 1:1.
  const vertical =
    typeof params.width === "number" &&
    typeof params.height === "number" &&
    params.height >= params.width;
  const short = typeof params.durationSeconds === "number" && params.durationSeconds <= SHORT_MAX_SECONDS;
  return vertical && short;
}

/**
 * El ancho y el alto como se VE el video.
 *
 * Un video de celular puede venir grabado apaisado con una marca de rotacion:
 * sin girarlo, un Short vertical se leia como horizontal.
 */
export function streamSize(
  stream: { widthPixels?: number; heightPixels?: number; rotation?: string } | undefined,
): { width: number | null; height: number | null } {
  const width = typeof stream?.widthPixels === "number" ? stream.widthPixels : null;
  const height = typeof stream?.heightPixels === "number" ? stream.heightPixels : null;
  const turned = stream?.rotation === "clockwise" || stream?.rotation === "counterClockwise";
  return turned ? { width: height, height: width } : { width, height };
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

/**
 * El perfil del canal, con lo que dio `channels.list` (parte `snippet`).
 *
 * El @ de YouTube (`customUrl`) viene con la arroba incluida: se guarda sin
 * ella, porque la pantalla la agrega.
 */
export function channelProfile(
  channelId: string,
  snippet: {
    title?: string;
    description?: string;
    customUrl?: string;
    thumbnails?: Record<string, { url?: string }>;
  },
): AccountProfile {
  const handle = snippet.customUrl?.trim().replace(/^@/, "") || null;
  return {
    username: handle,
    displayName: snippet.title?.trim() || null,
    avatarUrl:
      snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? null,
    bio: snippet.description?.trim() || null,
    profileUrl: handle
      ? `https://www.youtube.com/@${handle}`
      : `https://www.youtube.com/channel/${channelId}`,
  };
}

/**
 * Un contador de la Data API. Vienen como texto ("413"); uno que falta o no
 * es un numero queda en null, nunca en cero.
 */
export function count(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Los totales de un video segun la Data API (`videos.list`, parte
 * `statistics`): vistas, me gusta y comentarios de toda su vida.
 *
 * Es el respaldo de Analytics, que da mas columnas pero tarda dias en tener
 * un video nuevo. Lo que no vino queda en null: un video con los me gusta
 * ocultos no tiene cero me gusta.
 */
export function statisticsToMetrics(
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string } | undefined,
): PostMetrics {
  const views = count(statistics?.viewCount);
  const likes = count(statistics?.likeCount);
  const comments = count(statistics?.commentCount);
  const interactions = [likes, comments].filter((v): v is number => v !== null);

  return {
    ...EMPTY_POST_METRICS,
    views,
    likes,
    comments,
    engagementRate:
      interactions.length > 0 && views !== null && views > 0
        ? Number(((interactions.reduce((a, b) => a + b, 0) / views) * 100).toFixed(2))
        : null,
    extra: {},
  };
}

/**
 * Desde cuando pedirle a Analytics: el dia en que salio el video mas viejo
 * de la lista, o la ventana si es anterior o si no hay ninguna fecha.
 */
export function reportStartDate(
  windowStart: string,
  details: Map<string, { publishedAt: string | null }>,
): string {
  let oldest = windowStart;
  for (const detail of details.values()) {
    const day = detail.publishedAt?.slice(0, 10);
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day) && day < oldest) oldest = day;
  }
  return oldest;
}

/**
 * Los mensajes de error de Google traen HTML (`<code><a href=...>`). En la
 * pantalla se veian las etiquetas crudas.
 */
export function plainError(message: string | null | undefined): string | null {
  if (!message) return null;
  const text = message.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return text || null;
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
      return { ok: false, error: plainError(body.error.message) ?? "YouTube rechazo el pedido", status: res.status };
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

  // 1. El canal: perfil, suscriptores y la lista de subidas. Las tres partes
  // en el mismo pedido cuestan lo mismo que una.
  const channel = await apiGet<{
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        description?: string;
        customUrl?: string;
        thumbnails?: Record<string, { url?: string }>;
      };
      statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
  }>(
    `${DATA_API}/channels?part=snippet,statistics,contentDetails&id=${encodeURIComponent(params.channelId)}`,
    params.token,
    fetchImpl,
  );

  let uploadsPlaylist: string | null = null;
  let profile: AccountProfile | undefined;

  if (!channel.ok) {
    warnings.push(`YouTube (canal): ${channel.error}`);
  } else {
    const item = channel.data.items?.[0];
    uploadsPlaylist = item?.contentDetails?.relatedPlaylists?.uploads ?? null;
    if (item?.snippet) profile = channelProfile(params.channelId, item.snippet);
    // Los tres vienen como texto; uno que no vino queda en null, no en cero.
    const subscribers = count(item?.statistics?.subscriberCount);
    const videos = count(item?.statistics?.videoCount);
    const views = count(item?.statistics?.viewCount);
    // `profile` es lo que lee el encabezado de Social ("Videos", "Vistas"):
    // la misma forma que deja el lector de Zernio.
    const figures = {
      ...(videos !== null ? { videos } : {}),
      ...(views !== null ? { views } : {}),
    };
    if (subscribers !== null || Object.keys(figures).length > 0) {
      accountDaily.push({
        date: "",
        followers: subscribers,
        followersGained: null,
        followersLost: null,
        impressions: null,
        reach: null,
        profileViews: null,
        extra: Object.keys(figures).length > 0 ? { profile: figures } : {},
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
    {
      title: string | null;
      publishedAt: string | null;
      thumbnail: string | null;
      /** Lo que se deduce del archivo, si YouTube no dice que es. */
      guessedType: "short" | "video";
      durationSeconds: number | null;
      totals: PostMetrics;
    }
  >();
  // Lo que el canal no muestra: privados y transmisiones que nunca salieron.
  const hiddenPostIds: string[] = [];

  if (videoIds.length > 0) {
    const videos = await apiGet<{
      items?: Array<{
        id?: string;
        snippet?: { title?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> };
        contentDetails?: { duration?: string };
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
        status?: { privacyStatus?: string };
        liveStreamingDetails?: { actualStartTime?: string };
        fileDetails?: {
          videoStreams?: Array<{ widthPixels?: number; heightPixels?: number; rotation?: string }>;
        };
      }>;
    }>(
      // `fileDetails` trae el ancho y el alto (solo al dueño del canal): es el
      // respaldo para decidir si es un Short cuando Analytics no lo dice.
      // `status` y `liveStreamingDetails` dicen que no se muestra. Todas las
      // partes juntas cuestan lo mismo que una.
      `${DATA_API}/videos?part=snippet,contentDetails,statistics,status,liveStreamingDetails,fileDetails&id=${videoIds.join(",")}`,
      params.token,
      fetchImpl,
    );

    if (videos.ok) {
      for (const video of videos.data.items ?? []) {
        if (!video.id) continue;
        if (!isVisibleOnChannel(video)) {
          hiddenPostIds.push(video.id);
          continue;
        }
        const duration = parseIsoDuration(video.contentDetails?.duration);
        const stream = streamSize(video.fileDetails?.videoStreams?.[0]);
        details.set(video.id, {
          title: video.snippet?.title ?? null,
          publishedAt: video.snippet?.publishedAt ?? null,
          thumbnail:
            video.snippet?.thumbnails?.high?.url ?? video.snippet?.thumbnails?.default?.url ?? null,
          guessedType: youtubeMediaType({
            durationSeconds: duration,
            width: stream.width,
            height: stream.height,
          }),
          totals: statisticsToMetrics(video.statistics),
          durationSeconds: duration,
        });
      }
    } else {
      warnings.push(`YouTube (detalle): ${videos.error}`);
    }
  }

  // 4. Las metricas, en UNA llamada para todos los videos. Desde el dia en
  // que salio el mas viejo de la lista, no desde el inicio de la ventana: la
  // fila del dia guarda valores ACUMULADOS, y con la ventana un video de 60
  // dias quedaba con las vistas de los ultimos 30 como si fueran su total.
  const metricsByVideo = new Map<string, PostMetrics>();
  if (videoIds.length > 0) {
    const report = await apiGet<ReportResponse>(
      `${ANALYTICS_API}/reports?ids=channel==${encodeURIComponent(params.channelId)}` +
        `&startDate=${reportStartDate(params.startDate, details)}&endDate=${params.endDate}` +
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

  // 5. Que es cada video, segun YouTube: la misma clasificacion de las
  // pestañas del canal. Solo se pregunta por los de hasta 3 minutos: uno mas
  // largo no puede ser un Short.
  const candidates = [...details.entries()]
    .filter(([, d]) => d.durationSeconds === null || d.durationSeconds <= SHORT_MAX_SECONDS)
    .map(([id]) => id);
  const shortFlags = await readShortFlags(candidates, fetchImpl);

  for (const id of videoIds) {
    const detail = details.get(id);
    // Lo oculto no se devuelve: no tiene que aparecer en la grilla.
    if (hiddenPostIds.includes(id)) continue;
    posts.push({
      platform: "youtube",
      externalPostId: id,
      publisherRef: null,
      url: `https://www.youtube.com/watch?v=${id}`,
      caption: detail?.title ?? null,
      mediaType: detail ? mediaTypeFromFlag(shortFlags.get(id), detail.guessedType) : null,
      thumbnailUrl: detail?.thumbnail ?? null,
      publishedAt: detail?.publishedAt ?? null,
      // Analytics tarda dos o tres dias en tener un video nuevo: mientras
      // tanto, los totales de la Data API.
      metrics: metricsByVideo.get(id) ?? detail?.totals ?? { ...EMPTY_POST_METRICS },
    });
  }

  return {
    posts,
    accountDaily,
    warnings,
    ...(profile ? { profile } : {}),
    ...(hiddenPostIds.length > 0 ? { hiddenPostIds } : {}),
  };
}

/**
 * Si el video se ve en el canal.
 *
 * La lista de subidas, leida por su dueño, trae tambien lo privado y las
 * transmisiones programadas que nunca salieron al aire (con la portada del
 * canal como miniatura). Ninguna de las dos esta en el canal publico.
 * "No listado" si entra: es un video real, solo que sin buscador.
 */
export function isVisibleOnChannel(video: {
  status?: { privacyStatus?: string };
  liveStreamingDetails?: { actualStartTime?: string };
}): boolean {
  if (video.status?.privacyStatus === "private") return false;
  if (video.liveStreamingDetails && !video.liveStreamingDetails.actualStartTime) return false;
  return true;
}

/** La direccion de un Short. Es la que usa YouTube en la app y en el canal. */
export const SHORTS_URL = "https://www.youtube.com/shorts/";

/**
 * Si un video es un Short, segun YouTube.
 *
 * Ninguna API oficial lo dice por video: la Data API no tiene el campo, y el
 * reporte de Analytics con `creatorContentType` por video responde "The query
 * is not supported" (probado contra la API real el 10/10/2026, aunque la
 * documentacion lo lista). Lo que si lo dice es la direccion del Short:
 * `youtube.com/shorts/<id>` abre (200) si es un Short y redirige a
 * `/watch?v=` (303) si no lo es. No gasta cuota ni usa el token.
 *
 * Cualquier otra respuesta (una pagina de consentimiento, un error, la red
 * caida) es "no se sabe" (null): ahi decide el tamaño del archivo. Nunca
 * lanza.
 */
export async function checkIsShort(videoId: string, fetchImpl: typeof fetch): Promise<boolean | null> {
  try {
    const res = await fetchImpl(`${SHORTS_URL}${encodeURIComponent(videoId)}`, {
      method: "HEAD",
      redirect: "manual",
    });
    if (res.status === 200) return true;
    if (res.status >= 300 && res.status < 400 && (res.headers?.get("location") ?? "").includes("/watch")) {
      return false;
    }
    return null;
  } catch (err) {
    console.error(`[metricas] no pude saber si ${videoId} es un Short:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Cuantos videos se consultan a la vez: YouTube corta si son muchos juntos. */
const SHORTS_CHECK_CONCURRENCY = 5;

/** Si es un Short, para cada video. Los que no se pudieron saber no estan. */
export async function readShortFlags(videoIds: string[], fetchImpl: typeof fetch): Promise<Map<string, boolean>> {
  const flags = new Map<string, boolean>();
  for (let i = 0; i < videoIds.length; i += SHORTS_CHECK_CONCURRENCY) {
    const batch = videoIds.slice(i, i + SHORTS_CHECK_CONCURRENCY);
    const results = await Promise.all(batch.map((id) => checkIsShort(id, fetchImpl)));
    batch.forEach((id, index) => {
      const result = results[index];
      if (result !== null) flags.set(id, result);
    });
  }
  return flags;
}

/** Lo que dijo YouTube, y si no se supo, lo que se deduce del archivo. */
export function mediaTypeFromFlag(isShortFlag: boolean | undefined, guessed: "short" | "video"): "short" | "video" {
  if (isShortFlag === true) return "short";
  if (isShortFlag === false) return "video";
  return guessed;
}
