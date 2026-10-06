/**
 * Las cuentas del dashboard de contenido organico (F48, F50, F53).
 *
 * Todo puro: recibe las filas diarias ya leidas y devuelve lo que dibuja
 * cada tarjeta. Las consultas viven en la pagina; aca esta lo que hay que
 * poder probar sin base, que es donde se esconden los errores caros.
 *
 * Tres reglas que atraviesan el archivo:
 *
 * 1. **Un hueco es un hueco.** Un dia sin fila no aparece como cero: el
 *    grafico dibuja el corte. Un cero dice "ese dia no paso nada", y eso es
 *    una afirmacion distinta de "ese dia no sabemos".
 * 2. **Los seguidores no se suman, se toman.** Son un total acumulado: la
 *    semana no es la suma de sus dias, es el ULTIMO dia de la semana.
 *    Sumarlos daria numeros siete veces mas grandes.
 * 3. **Una red que no da una metrica no aporta cero.** LinkedIn sin alcance
 *    no baja el promedio: se excluye y se dice por que.
 */

import { funnelStageInfo } from "@/lib/content/classification";
import { daysBetween } from "@/lib/metrics/rules";
import { platformLabel } from "@/lib/platforms";
import { leadsTracked } from "./piece-leads";

export type Grouping = "day" | "week" | "month";

/** Una fila diaria de una publicacion, ya cruzada con su post. */
export interface PostDailyRow {
  socialPostId: string;
  platform: string;
  /** El formato de la publicacion: reel, carousel, short... */
  mediaType: string | null;
  date: string;
  views: number | null;
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  extra?: Record<string, unknown> | null;
}

/** Una fila diaria de una cuenta. */
export interface AccountDailyRow {
  platform: string;
  date: string;
  followers: number | null;
  followersGained: number | null;
  followersLost: number | null;
}

/** Una publicacion, para contar y agrupar por formato. */
export interface PublishedPost {
  socialPostId: string;
  platform: string;
  mediaType: string | null;
  publishedAt: string | null;
  origin: "system" | "external";
  engagementD7: number | null;
  /** La pieza de la que salio. Null = publicada a mano, fuera del sistema (F105). */
  contentPostId?: string | null;
}

// ── Agrupar por dia, semana o mes ────────────────────────────────────────

/** El lunes de la semana de esa fecha, como `YYYY-MM-DD`. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  // getUTCDay: 0 = domingo. Se corre al lunes anterior.
  const delta = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - delta);
  return d.toISOString().slice(0, 10);
}

/** El primer dia del mes de esa fecha. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** A que grupo cae una fecha. */
export function bucketOf(date: string, grouping: Grouping): string {
  if (grouping === "week") return weekStart(date);
  if (grouping === "month") return monthStart(date);
  return date;
}

export interface SeriesPoint {
  bucket: string;
  value: number | null;
}

/**
 * Suma una metrica por grupo.
 *
 * Un grupo SIN NINGUN dato no aparece en el resultado: lo dibuja como hueco
 * quien grafica. Un grupo con algunos dias sin dato suma los que hay, que es
 * lo correcto para una metrica de flujo (likes, alcance).
 */
export function sumByBucket(
  rows: Array<{ date: string; value: number | null }>,
  grouping: Grouping,
): SeriesPoint[] {
  const buckets = new Map<string, number>();

  for (const row of rows) {
    if (row.value === null) continue;
    const key = bucketOf(row.date, grouping);
    buckets.set(key, (buckets.get(key) ?? 0) + row.value);
  }

  return [...buckets.entries()]
    .map(([bucket, value]) => ({ bucket, value }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/**
 * El ULTIMO valor de cada grupo.
 *
 * Para los seguidores, que son un total acumulado y no un flujo. Sumarlos
 * daria la cifra multiplicada por la cantidad de dias.
 */
export function lastByBucket(
  rows: Array<{ date: string; value: number | null }>,
  grouping: Grouping,
): SeriesPoint[] {
  const buckets = new Map<string, { date: string; value: number }>();

  for (const row of rows) {
    if (row.value === null) continue;
    const key = bucketOf(row.date, grouping);
    const current = buckets.get(key);
    if (!current || row.date > current.date) buckets.set(key, { date: row.date, value: row.value });
  }

  return [...buckets.entries()]
    .map(([bucket, { value }]) => ({ bucket, value }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// ── KPI ──────────────────────────────────────────────────────────────────

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  /** Variacion contra el periodo anterior del mismo largo, en porcentaje. */
  changePercent: number | null;
  /** Cuando no se puede calcular, por que. */
  note?: string;
}

/**
 * La variacion entre dos numeros, en porcentaje.
 *
 * Null cuando no se puede: sin dato anterior no hay con que comparar, y
 * "creció 100%" desde cero es una afirmacion vacia que en un dashboard se
 * lee como un logro.
 */
export function changePercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

/** Suma una metrica de todas las filas, ignorando los nulls. */
export function total(rows: Array<{ value: number | null }>): number | null {
  const values = rows.map((r) => r.value).filter((v): v is number => v !== null);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
}

/** El total de seguidores al final del periodo, por red. */
export function followersAtEnd(rows: AccountDailyRow[]): Map<string, number> {
  const byPlatform = new Map<string, { date: string; followers: number }>();

  for (const row of rows) {
    if (row.followers === null) continue;
    const current = byPlatform.get(row.platform);
    if (!current || row.date > current.date) {
      byPlatform.set(row.platform, { date: row.date, followers: row.followers });
    }
  }

  return new Map([...byPlatform].map(([p, v]) => [p, v.followers]));
}

export interface KpiInput {
  posts: PublishedPost[];
  postDaily: PostDailyRow[];
  accountDaily: AccountDailyRow[];
  previous: {
    posts: PublishedPost[];
    postDaily: PostDailyRow[];
    accountDaily: AccountDailyRow[];
  };
}

/**
 * Las cinco cifras de arriba.
 *
 * "Engagement promedio" es el promedio de los engagement de cada post, no
 * interacciones sobre alcance del periodo entero: un post viral con mucho
 * alcance no tiene que tapar a los otros diez.
 */
export function computeKpis(input: KpiInput): Kpi[] {
  const followersNow = [...followersAtEnd(input.accountDaily).values()];
  const followersBefore = [...followersAtEnd(input.previous.accountDaily).values()];

  const sum = (values: number[]) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) : null);

  const reachOf = (rows: PostDailyRow[]) =>
    total(rows.map((r) => ({ value: r.reach ?? r.views ?? r.impressions })));

  const engagementOf = (rows: PostDailyRow[]) => {
    const byPost = new Map<string, { interactions: number; denominator: number | null }>();
    for (const row of rows) {
      const interactions = [row.likes, row.comments, row.shares, row.saves].filter(
        (v): v is number => v !== null,
      );
      if (interactions.length === 0) continue;
      const denominator = row.reach ?? row.views ?? null;
      const current = byPost.get(row.socialPostId);
      // La ultima foto de cada post: las metricas son acumuladas.
      if (!current || (denominator ?? 0) >= (current.denominator ?? 0)) {
        byPost.set(row.socialPostId, {
          interactions: interactions.reduce((a, b) => a + b, 0),
          denominator,
        });
      }
    }

    const rates = [...byPost.values()]
      .filter((p) => p.denominator !== null && p.denominator > 0)
      .map((p) => (p.interactions / (p.denominator as number)) * 100);

    return rates.length > 0 ? Number((rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2)) : null;
  };

  const followsOf = (rows: PostDailyRow[]) =>
    total(
      rows.map((r) => ({
        value: typeof r.extra?.follows === "number" ? (r.extra.follows as number) : null,
      })),
    );

  return [
    {
      key: "followers",
      label: "Seguidores",
      value: sum(followersNow),
      changePercent: changePercent(sum(followersNow), sum(followersBefore)),
    },
    {
      key: "reach",
      label: "Alcance y vistas",
      value: reachOf(input.postDaily),
      changePercent: changePercent(reachOf(input.postDaily), reachOf(input.previous.postDaily)),
    },
    {
      key: "posts",
      label: "Publicaciones",
      value: input.posts.length,
      changePercent: changePercent(input.posts.length, input.previous.posts.length),
    },
    {
      key: "engagement",
      label: "Engagement promedio",
      value: engagementOf(input.postDaily),
      changePercent: changePercent(engagementOf(input.postDaily), engagementOf(input.previous.postDaily)),
    },
    {
      key: "follows",
      label: "Follows organicos",
      value: followsOf(input.postDaily),
      changePercent: changePercent(followsOf(input.postDaily), followsOf(input.previous.postDaily)),
      note: "Solo Instagram lo informa.",
    },
  ];
}

// ── Crecimiento de seguidores ────────────────────────────────────────────

export interface GrowthPoint {
  bucket: string;
  gained: number | null;
  lost: number | null;
  total: number | null;
}

/**
 * Ganados, perdidos y total por grupo.
 *
 * Cuando la red no informa ganados y perdidos por separado (casi todas), se
 * DERIVAN de la diferencia entre dias consecutivos. Un dia que sube 12 son
 * 12 ganados; uno que baja 5 son 5 perdidos. No es exacto (alguien pudo
 * seguir y otro dejar de seguir el mismo dia) y por eso la pantalla lo
 * llama "neto".
 */
export function followerGrowth(rows: AccountDailyRow[], grouping: Grouping): GrowthPoint[] {
  const byDate = new Map<string, { followers: number | null; gained: number | null; lost: number | null }>();

  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const current = byDate.get(row.date) ?? { followers: null, gained: null, lost: null };
    byDate.set(row.date, {
      followers: row.followers === null ? current.followers : (current.followers ?? 0) + row.followers,
      gained: row.followersGained === null ? current.gained : (current.gained ?? 0) + row.followersGained,
      lost: row.followersLost === null ? current.lost : (current.lost ?? 0) + row.followersLost,
    });
  }

  const dates = [...byDate.keys()].sort();
  const derived: Array<{ date: string; gained: number | null; lost: number | null; total: number | null }> = [];

  let previousTotal: number | null = null;
  for (const date of dates) {
    const entry = byDate.get(date)!;
    let gained = entry.gained;
    let lost = entry.lost;

    if (gained === null && lost === null && entry.followers !== null && previousTotal !== null) {
      const delta = entry.followers - previousTotal;
      gained = delta > 0 ? delta : 0;
      lost = delta < 0 ? -delta : 0;
    }

    derived.push({ date, gained, lost, total: entry.followers });
    if (entry.followers !== null) previousTotal = entry.followers;
  }

  const gainedByBucket = sumByBucket(derived.map((d) => ({ date: d.date, value: d.gained })), grouping);
  const lostByBucket = sumByBucket(derived.map((d) => ({ date: d.date, value: d.lost })), grouping);
  const totalByBucket = lastByBucket(derived.map((d) => ({ date: d.date, value: d.total })), grouping);

  const buckets = [
    ...new Set([...gainedByBucket, ...lostByBucket, ...totalByBucket].map((p) => p.bucket)),
  ].sort();

  return buckets.map((bucket) => ({
    bucket,
    gained: gainedByBucket.find((p) => p.bucket === bucket)?.value ?? null,
    lost: lostByBucket.find((p) => p.bucket === bucket)?.value ?? null,
    total: totalByBucket.find((p) => p.bucket === bucket)?.value ?? null,
  }));
}

// ── Actividad y formatos ─────────────────────────────────────────────────

export interface ActivityPoint {
  bucket: string;
  /** Cuantas publicaciones de cada formato. */
  byFormat: Record<string, number>;
  total: number;
}

/** Publicaciones por grupo, apiladas por formato. */
export function publishActivity(posts: PublishedPost[], grouping: Grouping): ActivityPoint[] {
  const buckets = new Map<string, Record<string, number>>();

  for (const post of posts) {
    if (!post.publishedAt) continue;
    const key = bucketOf(post.publishedAt.slice(0, 10), grouping);
    const format = post.mediaType ?? "otro";
    const entry = buckets.get(key) ?? {};
    entry[format] = (entry[format] ?? 0) + 1;
    buckets.set(key, entry);
  }

  return [...buckets.entries()]
    .map(([bucket, byFormat]) => ({
      bucket,
      byFormat,
      total: Object.values(byFormat).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export interface FormatPerformance {
  format: string;
  posts: number;
  avgReach: number | null;
  avgEngagement: number | null;
}

/** Como rinde cada formato, en promedio. */
export function formatPerformance(
  posts: PublishedPost[],
  latestByPost: Map<string, PostDailyRow>,
): FormatPerformance[] {
  const byFormat = new Map<string, { posts: number; reach: number[]; engagement: number[] }>();

  for (const post of posts) {
    const format = post.mediaType ?? "otro";
    const entry = byFormat.get(format) ?? { posts: 0, reach: [], engagement: [] };
    entry.posts += 1;

    const row = latestByPost.get(post.socialPostId);
    const reach = row?.reach ?? row?.views ?? null;
    if (reach !== null) entry.reach.push(reach);

    const interactions = [row?.likes, row?.comments, row?.shares, row?.saves].filter(
      (v): v is number => typeof v === "number",
    );
    if (interactions.length > 0 && reach !== null && reach > 0) {
      entry.engagement.push((interactions.reduce((a, b) => a + b, 0) / reach) * 100);
    }

    byFormat.set(format, entry);
  }

  const avg = (values: number[]) =>
    values.length > 0 ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;

  return [...byFormat.entries()]
    .map(([format, entry]) => ({
      format,
      posts: entry.posts,
      avgReach: entry.reach.length > 0 ? Math.round(avg(entry.reach) as number) : null,
      avgEngagement: avg(entry.engagement),
    }))
    .sort((a, b) => b.posts - a.posts);
}

// ── Engagement a 7 dias por semana (F50) ─────────────────────────────────

export interface WeeklyD7 {
  week: string;
  /** Promedio por red. */
  byPlatform: Record<string, number>;
  /** La semana todavia tiene posts de menos de 7 dias. */
  inProgress: boolean;
}

/**
 * El engagement comparable, por semana de publicacion.
 *
 * La semana en curso se marca: sus posts todavia no cumplieron 7 dias y su
 * promedio va a subir. Mostrarla igual que las cerradas haria parecer que
 * el rendimiento se derrumbo esta semana.
 */
export function weeklyD7(posts: PublishedPost[], now: Date): WeeklyD7[] {
  const weeks = new Map<string, { byPlatform: Map<string, number[]>; inProgress: boolean }>();

  for (const post of posts) {
    if (!post.publishedAt) continue;
    const week = weekStart(post.publishedAt.slice(0, 10));
    const entry = weeks.get(week) ?? { byPlatform: new Map<string, number[]>(), inProgress: false };

    if (post.engagementD7 !== null) {
      const values = entry.byPlatform.get(post.platform) ?? [];
      values.push(post.engagementD7);
      entry.byPlatform.set(post.platform, values);
    } else if (daysBetween(post.publishedAt, now) < 7) {
      entry.inProgress = true;
    }

    weeks.set(week, entry);
  }

  return [...weeks.entries()]
    .map(([week, entry]) => ({
      week,
      byPlatform: Object.fromEntries(
        [...entry.byPlatform.entries()].map(([platform, values]) => [
          platform,
          Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)),
        ]),
      ),
      inProgress: entry.inProgress,
    }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

// ── Datos al dia (F53) ───────────────────────────────────────────────────

export interface FreshnessRow {
  platform: string;
  /** Cuando se sincronizo por ultima vez. */
  syncedAt: string | null;
  /** El ultimo dia con dato bueno. */
  lastDataDate: string | null;
  error: string | null;
  /** Que decir, en palabras. */
  label: string;
}

/**
 * Que tan fresco esta cada dato, por red.
 *
 * Un dashboard sin esto es un dashboard en el que nadie sabe si los numeros
 * son de hoy o de hace una semana porque algo se rompio.
 */
export function freshness(
  accounts: Array<{ platform: string; syncedAt: string | null; error: string | null }>,
  lastDataByPlatform: Map<string, string>,
  now: Date,
): FreshnessRow[] {
  return accounts.map((account) => {
    const lastDataDate = lastDataByPlatform.get(account.platform) ?? null;

    let label: string;
    if (account.error) {
      label = lastDataDate
        ? `La ultima actualizacion fallo. El ultimo dato bueno es del ${lastDataDate}.`
        : "La ultima actualizacion fallo y todavia no hay ningun dato.";
    } else if (!account.syncedAt) {
      label = "Todavia no se actualizo.";
    } else {
      const hours = Math.floor((now.getTime() - new Date(account.syncedAt).getTime()) / 3_600_000);
      label =
        hours < 1
          ? "Datos al dia."
          : hours < 24
            ? `Datos de hace ${hours} ${hours === 1 ? "hora" : "horas"}.`
            : `Datos de hace ${Math.floor(hours / 24)} dias.`;
    }

    return {
      platform: account.platform,
      syncedAt: account.syncedAt,
      lastDataDate,
      error: account.error,
      label,
    };
  });
}

/** Lo que se muestra cuando se filtra por una red que no da metricas. */
export function unavailableMetricsNote(platform: string, postCount: number): string | null {
  if (platform !== "linkedin") return null;
  return postCount > 0
    ? `LinkedIn no ofrece metricas con esta conexion. En este periodo se publicaron ${postCount} ${postCount === 1 ? "pieza" : "piezas"}.`
    : "LinkedIn no ofrece metricas con esta conexion.";
}


// ── Agrupar y filtrar por la clasificacion de la pieza (F105) ────────────

/** Lo que el dashboard necesita saber de la pieza de cada publicacion. */
export interface PieceInfo {
  id: string;
  title: string;
  offerId: string | null;
  offerName: string | null;
  pillarId: string | null;
  pillarName: string | null;
  funnelStage: string | null;
}

/** El valor de filtro y la clave de grupo de "lo que no tiene". */
export const UNASSIGNED_KEY = "none";
export const UNASSIGNED_LABEL = "Sin asignar";

export type GroupDimension = "piece" | "offer" | "pillar" | "funnel" | "platform" | "format";

export const GROUP_DIMENSIONS: Array<{ value: GroupDimension; label: string }> = [
  { value: "piece", label: "Pieza" },
  { value: "offer", label: "Oferta" },
  { value: "pillar", label: "Pilar" },
  { value: "funnel", label: "Etapa del embudo" },
  { value: "platform", label: "Red" },
  { value: "format", label: "Formato" },
];

export function isGroupDimension(value: unknown): value is GroupDimension {
  return GROUP_DIMENSIONS.some((d) => d.value === value);
}

export const FORMAT_LABELS: Record<string, string> = {
  reel: "Reel",
  carousel: "Carrusel",
  image: "Imagen",
  story: "Story",
  video: "Video",
  short: "Short",
  text: "Texto",
  document: "Documento",
  otro: "Sin formato",
};

export interface ClassificationFilters {
  piece?: string | null;
  offer?: string | null;
  pillar?: string | null;
  funnel?: string | null;
  format?: string | null;
}

/** Los cinco ejes de una publicacion: [clave, etiqueta], o "Sin asignar". */
function dimensionOf(
  post: PublishedPost,
  pieces: Map<string, PieceInfo>,
  dimension: GroupDimension,
): { key: string; label: string } {
  const piece = post.contentPostId ? pieces.get(post.contentPostId) : undefined;
  const none = { key: UNASSIGNED_KEY, label: UNASSIGNED_LABEL };

  switch (dimension) {
    case "piece":
      return piece ? { key: piece.id, label: piece.title.trim() || "Sin título" } : none;
    case "offer":
      return piece?.offerId ? { key: piece.offerId, label: piece.offerName ?? "Oferta archivada" } : none;
    case "pillar":
      return piece?.pillarId ? { key: piece.pillarId, label: piece.pillarName ?? "Pilar archivado" } : none;
    case "funnel": {
      const info = funnelStageInfo(piece?.funnelStage);
      return info ? { key: info.value, label: info.label } : none;
    }
    case "platform":
      return { key: post.platform, label: platformLabel(post.platform) };
    case "format":
      return post.mediaType
        ? { key: post.mediaType, label: FORMAT_LABELS[post.mediaType] ?? post.mediaType }
        : none;
  }
}

/**
 * Si una publicacion pasa los filtros.
 *
 * `none` elige lo SIN asignar: la pieza sin oferta, y tambien lo publicado a
 * mano, que no tiene pieza y por eso no tiene oferta. Una publicacion cuya
 * pieza ya no se conoce se trata igual: sin pieza no hay clasificacion.
 */
export function matchesClassification(
  post: PublishedPost,
  pieces: Map<string, PieceInfo>,
  filters: ClassificationFilters,
): boolean {
  const checks: Array<[string | null | undefined, GroupDimension]> = [
    [filters.piece, "piece"],
    [filters.offer, "offer"],
    [filters.pillar, "pillar"],
    [filters.funnel, "funnel"],
    [filters.format, "format"],
  ];

  return checks.every(([wanted, dimension]) => {
    if (!wanted) return true;
    return dimensionOf(post, pieces, dimension).key === wanted;
  });
}

export interface GroupRow {
  key: string;
  label: string;
  /** Es el grupo de lo que no tiene valor en esta dimension. */
  unassigned: boolean;
  posts: number;
  /** Piezas distintas (lo publicado a mano no suma). */
  pieces: number;
  /** Suma de lo crudo de cada publicacion: contexto, no ranking. */
  reach: number | null;
  interactions: number | null;
  /** Promedio del engagement de cada publicacion (la ultima foto). */
  avgEngagement: number | null;
  /** Promedio del engagement a 7 dias de las que ya lo tienen. */
  avgEngagementD7: number | null;
  /** Contactos que llegaron por comentario a estas publicaciones. Null = no se mide. */
  leads: number | null;
}

/**
 * El rendimiento agrupado por pieza, oferta, pilar, etapa del embudo, red o
 * formato.
 *
 * Tres reglas:
 *
 * 1. **Nada se pierde.** Toda publicacion cae en exactamente un grupo: la suma
 *    de las filas es el total. Lo que no tiene valor (una pieza sin oferta, lo
 *    publicado a mano) va a "Sin asignar" en vez de desaparecer, y siempre al
 *    final: un grupo gris no puede quedar arriba de los que se eligieron.
 * 2. **Red y formato son los de CADA publicacion**, no los de la pieza (D1): una
 *    pieza que fue Reel en Instagram y video en TikTok agrupa en los dos.
 * 3. **Ningun cero inventado.** Una publicacion sin metricas cuenta como
 *    publicacion y no baja los promedios; los leads de una red que no vincula
 *    comentarios son un hueco, no un cero.
 */
export function groupPerformance(params: {
  posts: PublishedPost[];
  latestByPost: Map<string, PostDailyRow>;
  pieces: Map<string, PieceInfo>;
  /** Leads por publicacion (F104), o null si no se pudieron leer. */
  leadsByPost: Map<string, number> | null;
  dimension: GroupDimension;
}): GroupRow[] {
  interface Acc {
    label: string;
    posts: number;
    pieces: Set<string>;
    reach: number[];
    interactions: number[];
    engagement: number[];
    d7: number[];
    leads: Array<number | null>;
  }
  const groups = new Map<string, Acc>();

  for (const post of params.posts) {
    const { key, label } = dimensionOf(post, params.pieces, params.dimension);
    const acc: Acc = groups.get(key) ?? {
      label,
      posts: 0,
      pieces: new Set(),
      reach: [],
      interactions: [],
      engagement: [],
      d7: [],
      leads: [],
    };

    acc.posts += 1;
    if (post.contentPostId && params.pieces.has(post.contentPostId)) acc.pieces.add(post.contentPostId);

    const row = params.latestByPost.get(post.socialPostId);
    const reach = row?.reach ?? row?.views ?? null;
    if (reach !== null) acc.reach.push(reach);

    const parts = [row?.likes, row?.comments, row?.shares, row?.saves].filter(
      (v): v is number => typeof v === "number",
    );
    const interactions = parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;
    if (interactions !== null) acc.interactions.push(interactions);
    if (interactions !== null && reach !== null && reach > 0) {
      acc.engagement.push((interactions / reach) * 100);
    }

    if (post.engagementD7 !== null) acc.d7.push(post.engagementD7);

    acc.leads.push(
      params.leadsByPost && leadsTracked(post.platform) ? (params.leadsByPost.get(post.socialPostId) ?? 0) : null,
    );

    groups.set(key, acc);
  }

  const sum = (values: number[]) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) : null);
  const avg = (values: number[]) =>
    values.length > 0 ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;

  return [...groups.entries()]
    .map(([key, acc]) => ({
      key,
      label: acc.label,
      unassigned: key === UNASSIGNED_KEY,
      posts: acc.posts,
      pieces: acc.pieces.size,
      reach: sum(acc.reach),
      interactions: sum(acc.interactions),
      avgEngagement: avg(acc.engagement),
      avgEngagementD7: avg(acc.d7),
      leads: sum(acc.leads.filter((v): v is number => v !== null)),
    }))
    .sort((a, b) => {
      if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
      return b.posts - a.posts || a.label.localeCompare(b.label);
    });
}

/** El total de abajo de la tabla: la suma de las filas, sin que ninguna se pierda. */
export function sumTotals(rows: GroupRow[]): {
  posts: number;
  reach: number | null;
  interactions: number | null;
  leads: number | null;
} {
  const sum = (values: Array<number | null>) => {
    const present = values.filter((v): v is number => v !== null);
    return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
  };
  return {
    posts: rows.reduce((total, r) => total + r.posts, 0),
    reach: sum(rows.map((r) => r.reach)),
    interactions: sum(rows.map((r) => r.interactions)),
    leads: sum(rows.map((r) => r.leads)),
  };
}
