/**
 * Los limites de cada red (§9.6).
 *
 * Estan en un solo lugar y con fecha de verificacion, porque cambian: lo que
 * hoy son 90 segundos de Reel mañana son otros. Cuando una publicacion falle
 * por un limite, el arreglo es esta tabla y no diez validaciones sueltas.
 *
 * Son datos puros; quien valida es `validation.ts`.
 */

export interface PlatformLimits {
  /** Maximo de caracteres del texto que acompaña. */
  textMax: number;
  /** Requiere al menos un archivo. */
  requiresMedia: boolean;
  image?: { maxBytes: number; maxCount?: number; minCount?: number };
  video?: { maxBytes: number; minSeconds?: number; maxSeconds: number };
  document?: { maxBytes: number; maxPages?: number };
  /** Cuantas publicaciones por dia acepta la red. */
  dailyMax: number;
  /**
   * Tope aparte por tipo, cuando la red lo tiene (TikTok: 15 videos y 15
   * fotos por dia, no 30 de cualquier cosa). Convive con `dailyMax`.
   */
  dailyMaxByKind?: { video: number; image: number };
  /** Titulo propio (YouTube). */
  titleMax?: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * Verificado contra la documentacion de cada red el 26/9/2026.
 *
 * Los valores de Instagram y TikTok salen de lo que acepta Zernio, que es por
 * donde se publica; los de YouTube, LinkedIn y Threads, de sus APIs.
 */
export const PLATFORM_LIMITS: Record<string, PlatformLimits> = {
  instagram: {
    textMax: 2200,
    requiresMedia: true,
    image: { maxBytes: 8 * MB, maxCount: 10, minCount: 1 },
    video: { maxBytes: 300 * MB, maxSeconds: 90 },
    dailyMax: 100,
  },
  tiktok: {
    textMax: 2200,
    requiresMedia: true,
    image: { maxBytes: 20 * MB, maxCount: 35, minCount: 1 },
    video: { maxBytes: 4 * GB, minSeconds: 3, maxSeconds: 600 },
    dailyMax: 30,
    dailyMaxByKind: { video: 15, image: 15 },
  },
  youtube: {
    textMax: 5000,
    titleMax: 100,
    requiresMedia: true,
    video: { maxBytes: 128 * GB, maxSeconds: 12 * 60 * 60 },
    dailyMax: 100,
  },
  linkedin: {
    textMax: 3000,
    requiresMedia: false,
    image: { maxBytes: 10 * MB, maxCount: 20 },
    video: { maxBytes: 500 * MB, minSeconds: 3, maxSeconds: 30 * 60 },
    document: { maxBytes: 100 * MB, maxPages: 300 },
    dailyMax: 150,
  },
  threads: {
    textMax: 500,
    requiresMedia: false,
    image: { maxBytes: 8 * MB, maxCount: 10 },
    video: { maxBytes: 1 * GB, maxSeconds: 300 },
    dailyMax: 250,
  },
};

/** Un video vertical de hasta esto se publica como Short. */
export const YOUTUBE_SHORT_MAX_SECONDS = 180;

export function limitsFor(platform: string): PlatformLimits | null {
  return PLATFORM_LIMITS[platform] ?? null;
}

/** "8 MB", "1,5 GB": para los mensajes de error. */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes % GB === 0 ? 0 : 1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

/** "90 segundos", "10 minutos". */
export function formatSeconds(seconds: number): string {
  if (seconds < 120) return `${seconds} segundos`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutos`;
  return `${Math.round(seconds / 3600)} horas`;
}
