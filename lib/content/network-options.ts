/**
 * Las opciones propias de cada red (§9.5, A8, A9, A17).
 *
 * `networks[].options` existia desde el bloque 3 pero **nadie lo escribia**:
 * no habia interfaz ni esquema. Por eso Instagram no podia publicar una
 * historia, TikTok no mandaba los campos que la API exige, y todo lo que
 * subia a YouTube quedaba privado.
 *
 * Aca vive la forma de cada una, con sus valores por defecto. Es la fuente
 * para los tres lados: la fila de la red en el editor arma sus controles
 * desde esto, la validacion decide si se puede programar, y el publicador
 * manda lo que corresponde.
 *
 * Sin dependencias de servidor: lo importa la pantalla.
 */

import { z } from "zod";

// ── Instagram (A9) ─────────────────────────────────────────────────────────

/**
 * El tipo de Instagram ("Tipo") se elimino: era el mismo dato que `format`,
 * duplicado (Contenido v4, C9). `networks[].format` es ahora el unico campo
 * de formato.
 */
export const instagramOptionsSchema = z.object({
  /** Un Reel tambien aparece en el feed. */
  shareToFeed: z.boolean().optional(),
  collaborators: z.array(z.string()).max(3).optional(),
  coverOffsetMs: z.number().int().min(0).optional(),
});

// ── TikTok (A8) ────────────────────────────────────────────────────────────

export const TIKTOK_MODES = ["public", "draft"] as const;
export const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"] as const;
export const TIKTOK_COMMERCIAL = ["none", "brand_organic", "brand_content"] as const;

export const TIKTOK_MODE_LABELS: Record<(typeof TIKTOK_MODES)[number], string> = {
  public: "Publicar en TikTok",
  draft: "Dejarlo como borrador en la app",
};

export const TIKTOK_PRIVACY_LABELS: Record<(typeof TIKTOK_PRIVACY)[number], string> = {
  PUBLIC_TO_EVERYONE: "Publico",
  MUTUAL_FOLLOW_FRIENDS: "Solo amigos",
  SELF_ONLY: "Solo yo",
};

export const tiktokOptionsSchema = z.object({
  mode: z.enum(TIKTOK_MODES).optional(),
  privacyLevel: z.enum(TIKTOK_PRIVACY).optional(),
  allowComment: z.boolean().optional(),
  allowDuet: z.boolean().optional(),
  allowStitch: z.boolean().optional(),
  commercialContentType: z.enum(TIKTOK_COMMERCIAL).optional(),
  coverOffsetMs: z.number().int().min(0).optional(),
  /**
   * Las dos confirmaciones que TikTok EXIGE para publicar por API.
   *
   * No son burocracia nuestra: su politica pide que la persona haya visto
   * como va a quedar el post y haya dado su consentimiento. Sin ellas la API
   * rechaza la publicacion con un error que no explica nada.
   */
  contentPreviewConfirmed: z.boolean().optional(),
  expressConsentGiven: z.boolean().optional(),
});

// ── YouTube (A17) ──────────────────────────────────────────────────────────

export const YOUTUBE_VISIBILITY = ["public", "unlisted", "private"] as const;
export type YouTubeVisibility = (typeof YOUTUBE_VISIBILITY)[number];

export const YOUTUBE_VISIBILITY_LABELS: Record<YouTubeVisibility, string> = {
  public: "Publica",
  unlisted: "No listada",
  private: "Privada",
};

export const youtubeOptionsSchema = z.object({
  visibility: z.enum(YOUTUBE_VISIBILITY).optional(),
  madeForKids: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

// ── LinkedIn y Threads ─────────────────────────────────────────────────────

export const LINKEDIN_POST_TYPES = ["text", "image", "multi_image", "video", "document"] as const;

export const linkedinOptionsSchema = z.object({
  postType: z.enum(LINKEDIN_POST_TYPES).optional(),
  documentTitle: z.string().optional(),
});

export const THREADS_REPLY_CONTROL = ["everyone", "accounts_you_follow", "mentioned_only"] as const;

export const threadsOptionsSchema = z.object({
  threadItems: z.array(z.string()).optional(),
  replyControl: z.enum(THREADS_REPLY_CONTROL).optional(),
});

// ── El registro ────────────────────────────────────────────────────────────

const SCHEMAS = {
  instagram: instagramOptionsSchema,
  tiktok: tiktokOptionsSchema,
  youtube: youtubeOptionsSchema,
  linkedin: linkedinOptionsSchema,
  threads: threadsOptionsSchema,
} as const;

export type NetworkOptions = Record<string, unknown>;

/**
 * Limpia las opciones de una red.
 *
 * Lo que no encaja se descarta en vez de romper: una opcion vieja o de otra
 * red no puede impedir que la pieza se abra. Lo que importa que este bien es
 * lo que se valida antes de programar.
 */
export function parseNetworkOptions(platform: string, raw: unknown): NetworkOptions {
  const schema = SCHEMAS[platform as keyof typeof SCHEMAS];
  if (!schema) return {};
  const result = schema.safeParse(raw ?? {});
  return result.success ? (result.data as NetworkOptions) : {};
}

/**
 * Lo que falta para poder programar esa red.
 *
 * Devuelve mensajes para mostrar, no excepciones: la pantalla los pone al
 * lado del control que falta.
 */
export function missingRequiredOptions(platform: string, raw: unknown): string[] {
  const options = parseNetworkOptions(platform, raw) as Record<string, unknown>;
  const missing: string[] = [];

  if (platform === "tiktok") {
    if (options.mode === "draft") return missing;
    if (!options.privacyLevel) {
      missing.push("Elegi quien puede ver el video en TikTok.");
    }
    if (options.contentPreviewConfirmed !== true) {
      missing.push("TikTok pide que confirmes que viste como va a quedar el post.");
    }
    if (options.expressConsentGiven !== true) {
      missing.push("TikTok pide tu consentimiento explicito para publicar por API.");
    }
  }

  return missing;
}

/** Lo que se guarda al agregar una red nueva a una pieza. */
export function defaultOptionsFor(platform: string): NetworkOptions {
  if (platform === "tiktok") {
    return {
      mode: "public",
      privacyLevel: "PUBLIC_TO_EVERYONE",
      allowComment: true,
      allowDuet: true,
      allowStitch: true,
      commercialContentType: "none",
      contentPreviewConfirmed: false,
      expressConsentGiven: false,
    };
  }
  // La privada es el default de YouTube y tambien lo mas seguro: se elige
  // publicarlo, no se publica por descuido.
  if (platform === "youtube") return { visibility: "private", madeForKids: false };
  if (platform === "threads") return { replyControl: "everyone" };
  return {};
}
