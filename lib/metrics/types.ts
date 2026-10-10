/**
 * La forma comun de todo lo que leen los lectores de metricas (F42 a F44).
 *
 * Cinco redes con cinco APIs distintas terminan aca. Lo que el resto del
 * sistema ve es esto, no la respuesta de cada proveedor: asi el dashboard, la
 * tabla y el calculo de engagement se escriben una vez.
 *
 * La regla que atraviesa todo el modulo: **`null` no es cero**. Un metric que
 * la red no devolvio es `null` y no se escribe. Un cero inventado se lee en
 * el grafico como "ese dia no paso nada", que es una afirmacion distinta y
 * falsa.
 */

/** Las metricas de UNA publicacion, acumuladas al dia que se leyeron. */
export interface PostMetrics {
  views: number | null;
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  watchTimeSeconds: number | null;
  avgViewDurationSeconds: number | null;
  engagementRate: number | null;
  /** Lo propio de cada red. */
  extra: Record<string, unknown>;
}

export const EMPTY_POST_METRICS: PostMetrics = {
  views: null,
  impressions: null,
  reach: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  watchTimeSeconds: null,
  avgViewDurationSeconds: null,
  engagementRate: null,
  extra: {},
};

/** Lo que se sabe de una publicacion: quien es, mas sus numeros. */
export interface PostSnapshot {
  platform: string;
  /** El id del post EN LA RED. Es la clave para cruzarlo con lo nuestro. */
  externalPostId: string;
  /** El id que Zernio le dio, cuando salio por ahi. */
  publisherRef: string | null;
  url: string | null;
  caption: string | null;
  mediaType: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  metrics: PostMetrics;
}

/** Las metricas de una CUENTA en un dia. */
export interface AccountSnapshot {
  date: string;
  followers: number | null;
  followersGained: number | null;
  followersLost: number | null;
  impressions: number | null;
  reach: number | null;
  profileViews: number | null;
  extra: Record<string, unknown>;
}

/** Lo que devuelve un lector. */
export interface ReaderResult {
  posts: PostSnapshot[];
  accountDaily: AccountSnapshot[];
  /**
   * Lo que no se pudo leer, en palabras.
   *
   * Una lista y no un booleano: una red puede traer los posts y fallar en los
   * seguidores, y eso no es "fallo la sincronizacion".
   */
  warnings: string[];
  /**
   * Lo que el lector supo del perfil de la cuenta (foto, usuario, nombre,
   * bio). Ausente = el lector no lo lee; un campo en null = la red no lo dio
   * y no se pisa lo que habia.
   */
  profile?: AccountProfile;
}

export interface AccountProfile {
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  profileUrl: string | null;
}

export const EMPTY_READER_RESULT: ReaderResult = { posts: [], accountDaily: [], warnings: [] };

/** Un numero del proveedor, o null si no vino. Nunca cero por las dudas. */
export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Un numero que solo tiene sentido si es mayor que cero (duraciones). */
export function positive(value: unknown): number | null {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
}

/** Milisegundos a segundos, conservando el null. */
export function msToSeconds(value: unknown): number | null {
  const n = positive(value);
  return n === null ? null : Math.round(n / 1000);
}
