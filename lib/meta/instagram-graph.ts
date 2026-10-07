/**
 * Lo que solo se puede leer por la Graph de Meta (F43).
 *
 * Zernio da las metricas de cada post, pero hay tres cosas que no:
 *
 *  - **El alcance por tipo de seguidor.** Saber que el 70% del alcance vino
 *    de gente que NO te sigue es la diferencia entre "funciono" y "funciono
 *    para traer gente nueva".
 *  - **La audiencia de la cuenta**: edad, genero, pais.
 *  - **Las historias activas**, que duran 24 horas y por eso no se guardan:
 *    se consultan en vivo con cache (F54).
 *
 * Portado de un sistema anterior. Conserva lo que ahi se aprendio a golpes: Meta
 * reemplazo los metrics de audiencia por `follower_demographics` con
 * breakdown, y las cuentas viejas todavia responden a los anteriores, asi
 * que se intentan los dos.
 *
 * Todo degrada: si un bloque falla, los otros se devuelven igual. Una cuenta
 * sin permiso de insights no puede dejar sin metricas a todo el resto.
 */

import {
  breakdownInsight,
  graphGet,
  humanizeGraphError,
  seriesInsight,
  sumInsight,
  type InsightNode,
} from "./graph";

export interface ReachBreakdown {
  followers: number;
  nonFollowers: number;
  unknown: number;
}

/**
 * Alcance de un post entre seguidores y no seguidores.
 *
 * Null cuando Meta no lo da: el tipo de media puede no soportarlo, y
 * escribir ceros diria que el post no llego a nadie.
 */
export async function readReachBreakdown(params: {
  mediaId: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<ReachBreakdown | null> {
  const res = await graphGet<{ data?: InsightNode[] }>(
    `${params.mediaId}/insights`,
    params.token,
    { metric: "reach", breakdown: "follow_type" },
    params.fetchImpl,
  );
  if (!res.ok) return null;

  const map = breakdownInsight(res.data.data, "reach");
  if (Object.keys(map).length === 0) return null;

  return {
    followers: map.FOLLOWER ?? 0,
    nonFollowers: map.NON_FOLLOWER ?? 0,
    unknown: Object.entries(map)
      .filter(([k]) => k !== "FOLLOWER" && k !== "NON_FOLLOWER")
      .reduce((sum, [, v]) => sum + v, 0),
  };
}

export interface AccountInsights {
  /** Serie diaria de seguidores ganados, tal como la da Meta. */
  followerCountByDay: Array<{ date: string; value: number }>;
  reach: number | null;
  impressions: number | null;
  profileViews: number | null;
  warnings: string[];
}

/**
 * Insights de la cuenta de los ultimos dias.
 *
 * `follower_count` es lo unico con historia que da Instagram, y solo de 30
 * dias. Es la unica forma de tener la curva de crecimiento antes de conectar
 * la cuenta; despues la arman nuestras propias filas diarias.
 */
export async function readAccountInsights(params: {
  igId: string;
  token: string;
  since?: string;
  until?: string;
  fetchImpl?: typeof fetch;
}): Promise<AccountInsights> {
  const warnings: string[] = [];

  const [daily, totals] = await Promise.all([
    graphGet<{ data?: InsightNode[] }>(
      `${params.igId}/insights`,
      params.token,
      {
        metric: "follower_count",
        period: "day",
        ...(params.since ? { since: params.since } : {}),
        ...(params.until ? { until: params.until } : {}),
      },
      params.fetchImpl,
    ),
    graphGet<{ data?: InsightNode[] }>(
      `${params.igId}/insights`,
      params.token,
      { metric: "reach,impressions,profile_views", period: "day" },
      params.fetchImpl,
    ),
  ]);

  if (!daily.ok) warnings.push(`Seguidores por dia: ${humanizeGraphError(daily.error)}`);
  if (!totals.ok) warnings.push(`Alcance de la cuenta: ${humanizeGraphError(totals.error)}`);

  return {
    followerCountByDay: daily.ok ? seriesInsight(daily.data.data, "follower_count") : [],
    reach: totals.ok ? sumInsight(totals.data.data, "reach") : null,
    impressions: totals.ok ? sumInsight(totals.data.data, "impressions") : null,
    profileViews: totals.ok ? sumInsight(totals.data.data, "profile_views") : null,
    warnings,
  };
}

export interface Audience {
  ageGender: Record<string, number>;
  country: Record<string, number>;
  city: Record<string, number>;
}

/**
 * La audiencia de la cuenta.
 *
 * Se intenta primero el metric viejo y se cae al nuevo. Meta los cambio y
 * las cuentas no migraron todas a la vez: probar los dos es lo que hace que
 * ande en las dos.
 */
export async function readAudience(params: {
  igId: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<Audience> {
  const out: Audience = { ageGender: {}, country: {}, city: {} };

  const legacy = await Promise.all(
    (
      [
        ["audience_gender_age", "ageGender"],
        ["audience_country", "country"],
        ["audience_city", "city"],
      ] as const
    ).map(async ([metric, key]) => {
      const res = await graphGet<{ data?: InsightNode[] }>(
        `${params.igId}/insights`,
        params.token,
        { metric, period: "lifetime" },
        params.fetchImpl,
      );
      return [key, res.ok ? breakdownInsight(res.data.data, metric) : {}] as const;
    }),
  );
  for (const [key, map] of legacy) if (Object.keys(map).length > 0) out[key] = map;

  for (const [key, breakdown] of [
    ["ageGender", "age,gender"],
    ["country", "country"],
    ["city", "city"],
  ] as const) {
    if (Object.keys(out[key]).length > 0) continue;
    const res = await graphGet<{ data?: InsightNode[] }>(
      `${params.igId}/insights`,
      params.token,
      { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown },
      params.fetchImpl,
    );
    if (res.ok) {
      const map = breakdownInsight(res.data.data, "follower_demographics");
      if (Object.keys(map).length > 0) out[key] = map;
    }
  }

  return out;
}

export interface StoryItem {
  id: string;
  mediaType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
  metrics: Record<string, number>;
}

/**
 * Las historias activas, con sus metricas.
 *
 * NO se guardan: duran 24 horas y guardarlas llenaria la tabla de filas que
 * dejan de significar algo al otro dia. La pagina Social las pide en vivo
 * con cache de 15 minutos (F54).
 */
export async function readActiveStories(params: {
  igId: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<{ stories: StoryItem[]; warning: string | null }> {
  const res = await graphGet<{
    data?: Array<{
      id: string;
      media_type?: string;
      media_url?: string;
      thumbnail_url?: string;
      permalink?: string;
      timestamp?: string;
    }>;
  }>(
    `${params.igId}/stories`,
    params.token,
    { fields: "id,media_type,media_url,thumbnail_url,permalink,timestamp" },
    params.fetchImpl,
  );

  if (!res.ok) return { stories: [], warning: humanizeGraphError(res.error) };

  const stories = await Promise.all(
    (res.data.data ?? []).map(async (story) => {
      const insights = await graphGet<{ data?: InsightNode[] }>(
        `${story.id}/insights`,
        params.token,
        { metric: "reach,replies,taps_forward,taps_back,exits" },
        params.fetchImpl,
      );

      const metrics: Record<string, number> = {};
      if (insights.ok) {
        for (const name of ["reach", "replies", "taps_forward", "taps_back", "exits"]) {
          const value = sumInsight(insights.data.data, name);
          if (value !== null) metrics[name] = value;
        }
      }

      return {
        id: story.id,
        mediaType: story.media_type ?? null,
        mediaUrl: story.media_url ?? null,
        thumbnailUrl: story.thumbnail_url ?? null,
        permalink: story.permalink ?? null,
        timestamp: story.timestamp ?? null,
        metrics,
      };
    }),
  );

  return { stories, warning: null };
}

export interface IgProfile {
  username: string | null;
  name: string | null;
  biography: string | null;
  website: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
}

/** Los datos de perfil, para la pagina Social (F54). */
export async function readProfile(params: {
  igId: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<IgProfile | null> {
  const res = await graphGet<Record<string, unknown>>(
    params.igId,
    params.token,
    {
      fields:
        "username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count",
    },
    params.fetchImpl,
  );
  if (!res.ok) return null;

  const d = res.data;
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    username: typeof d.username === "string" ? d.username : null,
    name: typeof d.name === "string" ? d.name : null,
    biography: typeof d.biography === "string" ? d.biography : null,
    website: typeof d.website === "string" ? d.website : null,
    profilePictureUrl: typeof d.profile_picture_url === "string" ? d.profile_picture_url : null,
    followersCount: n(d.followers_count),
    followsCount: n(d.follows_count),
    mediaCount: n(d.media_count),
  };
}
