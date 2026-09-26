/**
 * Validar una pieza red por red, antes de programar (F26).
 *
 * La diferencia entre un error y una advertencia importa: un error impide
 * programar esa red, una advertencia avisa y deja seguir. Un Reel de 95
 * segundos no se puede publicar (error). Un video vertical corto en YouTube
 * se va a publicar como Short, lo cual puede no ser lo que se esperaba
 * (advertencia).
 *
 * Y una red con errores NO frena a las demas: se programan las que estan
 * bien. Frenar todo porque falta el titulo de YouTube seria castigar al resto.
 */

import { formatBytes, formatSeconds, limitsFor, YOUTUBE_SHORT_MAX_SECONDS } from "./limits";
import type { MediaEntry } from "./media";

export interface NetworkContent {
  platform: string;
  /** El caption propio o el base, ya resuelto. */
  text: string;
  /** La media propia o la base, ya resuelta. */
  media: MediaEntry[];
  /** Solo YouTube. */
  title?: string | null;
  options?: Record<string, unknown>;
}

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
}

export interface NetworkValidation {
  platform: string;
  errors: string[];
  warnings: string[];
  /** Se puede programar esta red. */
  ok: boolean;
}

export interface ValidationContext {
  /** Cuantas publicaciones ya hay agendadas para ese dia y esa red. */
  publishedToday?: number;
}

export function validateNetwork(
  content: NetworkContent,
  context: ValidationContext = {},
): NetworkValidation {
  const issues: ValidationIssue[] = [];
  const limits = limitsFor(content.platform);

  if (!limits) {
    return {
      platform: content.platform,
      errors: [`No se como publicar en ${content.platform}`],
      warnings: [],
      ok: false,
    };
  }

  const error = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warning", message });

  if (content.text.length > limits.textMax) {
    error(
      `El texto tiene ${content.text.length} caracteres y ${content.platform} acepta ${limits.textMax}.`,
    );
  }

  const images = content.media.filter((m) => m.kind === "image" && !m.deleted_at);
  const videos = content.media.filter((m) => m.kind === "video" && !m.deleted_at);
  const documents = content.media.filter((m) => m.kind === "document" && !m.deleted_at);
  const total = images.length + videos.length + documents.length;

  if (limits.requiresMedia && total === 0) {
    error(`${content.platform} necesita al menos una imagen o un video.`);
  }

  if (limits.image) {
    if (limits.image.maxCount && images.length > limits.image.maxCount) {
      error(`${content.platform} acepta hasta ${limits.image.maxCount} imagenes y hay ${images.length}.`);
    }
    for (const image of images) {
      if (image.size_bytes > limits.image.maxBytes) {
        error(
          `Una imagen pesa ${formatBytes(image.size_bytes)} y el maximo de ${content.platform} es ${formatBytes(limits.image.maxBytes)}.`,
        );
      }
    }
  }

  if (limits.video) {
    for (const video of videos) {
      if (video.size_bytes > limits.video.maxBytes) {
        error(
          `El video pesa ${formatBytes(video.size_bytes)} y el maximo de ${content.platform} es ${formatBytes(limits.video.maxBytes)}.`,
        );
      }
      const seconds = video.duration_ms ? video.duration_ms / 1000 : null;
      if (seconds !== null) {
        if (seconds > limits.video.maxSeconds) {
          error(
            `El video dura ${formatSeconds(Math.round(seconds))} y ${content.platform} acepta hasta ${formatSeconds(limits.video.maxSeconds)}.`,
          );
        }
        if (limits.video.minSeconds && seconds < limits.video.minSeconds) {
          error(`El video dura menos de ${limits.video.minSeconds} segundos, que es el minimo de ${content.platform}.`);
        }
      }
    }
  }

  if (limits.document) {
    for (const doc of documents) {
      if (doc.size_bytes > limits.document.maxBytes) {
        error(
          `El PDF pesa ${formatBytes(doc.size_bytes)} y el maximo es ${formatBytes(limits.document.maxBytes)}.`,
        );
      }
    }
  } else if (documents.length > 0) {
    error(`${content.platform} no acepta documentos.`);
  }

  // ── Lo propio de cada red ────────────────────────────────────────────────

  if (content.platform === "youtube") {
    const title = (content.title ?? "").trim();
    if (!title) {
      error("YouTube necesita un titulo.");
    } else if (limits.titleMax && title.length > limits.titleMax) {
      error(`El titulo tiene ${title.length} caracteres y YouTube acepta ${limits.titleMax}.`);
    }
    if (videos.length === 0) error("YouTube necesita un video.");
    if (videos.length > 1) error("YouTube publica un video por vez.");

    const video = videos[0];
    const seconds = video?.duration_ms ? video.duration_ms / 1000 : null;
    const vertical = video?.width && video?.height ? video.height > video.width : false;
    if (vertical && seconds !== null && seconds <= YOUTUBE_SHORT_MAX_SECONDS) {
      // No es un error: es que va a salir en otro lado del que quiza se
      // esperaba, y eso conviene saberlo antes y no despues.
      warn("Es vertical y dura menos de 3 minutos: YouTube lo va a publicar como Short.");
    }
  }

  if (content.platform === "instagram") {
    const contentType = content.options?.contentType;
    if (contentType === "carousel" && images.length < 2) {
      error("Un carrusel de Instagram necesita al menos 2 imagenes.");
    }
    if (contentType === "story" && videos[0]?.duration_ms && videos[0].duration_ms > 60_000) {
      error("Una historia de Instagram acepta hasta 60 segundos.");
    }
  }

  if (content.platform === "tiktok") {
    const mode = content.options?.mode;
    if (mode !== undefined && mode !== "public" && mode !== "draft") {
      // TikTok solo permite estas dos por API: cualquier otra cosa la rechaza
      // el proveedor con un error que no explica nada.
      error("En TikTok solo se puede publicar en publico o dejarlo como borrador.");
    }
  }

  if (content.platform === "linkedin" && videos.length > 0 && images.length > 0) {
    error("LinkedIn no mezcla video con imagenes en la misma publicacion.");
  }

  if (context.publishedToday !== undefined && context.publishedToday >= limits.dailyMax) {
    error(
      `Ya hay ${context.publishedToday} publicaciones de ${content.platform} ese dia y el limite es ${limits.dailyMax}.`,
    );
  }

  const errors = issues.filter((i) => i.level === "error").map((i) => i.message);
  const warnings = issues.filter((i) => i.level === "warning").map((i) => i.message);

  return { platform: content.platform, errors, warnings, ok: errors.length === 0 };
}

/**
 * Valida varias redes.
 *
 * Devuelve cuales se pueden programar y cuales no: el pie del editor dice
 * "Programar 2 redes" y no "no se puede".
 */
export function validateAll(
  networks: NetworkContent[],
  context: (platform: string) => ValidationContext = () => ({}),
): { results: NetworkValidation[]; schedulable: string[]; blocked: string[] } {
  const results = networks.map((n) => validateNetwork(n, context(n.platform)));
  return {
    results,
    schedulable: results.filter((r) => r.ok).map((r) => r.platform),
    blocked: results.filter((r) => !r.ok).map((r) => r.platform),
  };
}
