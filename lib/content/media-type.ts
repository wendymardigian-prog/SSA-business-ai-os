/**
 * Qué tipo de publicación es lo que se va a mandar a una red (F77).
 *
 * La fila de `social_posts` guarda `media_type`, pero lo escribía solo la
 * sincronización de métricas, así que una publicación programada por el
 * sistema lo tenía en null hasta después de salir. Sin eso no se puede contar
 * cuántos videos y cuántas fotos de TikTok hay en un día, que es lo que limita
 * la red. Se calcula acá, con lo mismo que se va a publicar.
 *
 * Es una estimación para contar, no la verdad de la red: cuando la métrica
 * lee la publicación real, escribe el tipo definitivo encima.
 */

import type { SocialPostMediaType } from "@/lib/types/database";
import type { NetworkContent } from "./validation";

/** Los tipos que cuentan como "video" para el tope diario. */
const VIDEO_TYPES: SocialPostMediaType[] = ["video", "reel", "short", "story"];
/** Los que cuentan como "fotos". */
const IMAGE_TYPES: SocialPostMediaType[] = ["image", "carousel"];

export function socialMediaTypeFor(content: NetworkContent): SocialPostMediaType {
  const media = content.media.filter((m) => !m.deleted_at);
  const videos = media.filter((m) => m.kind === "video");
  const images = media.filter((m) => m.kind === "image");
  const documents = media.filter((m) => m.kind === "document");

  // Un Short elegido como formato cuenta como Short (F93).
  if (content.platform === "youtube" && content.format === "short") return "short";

  if (content.platform === "instagram") {
    if (content.format === "story") return "story";
    if (content.format === "reel") return "reel";
    if (content.format === "carousel") return "carousel";
  }

  if (videos.length > 0) {
    // Un video vertical corto de YouTube sale como Short; el tope diario no
    // distingue, asi que para contar alcanza con "video".
    return content.platform === "instagram" ? "reel" : "video";
  }
  if (documents.length > 0) return "document";
  if (images.length > 1) return "carousel";
  if (images.length === 1) return "image";
  return "text";
}

/** Cómo cuenta un tipo contra el tope diario por tipo; null si no cuenta. */
export function dailyKindOf(type: string | null | undefined): "video" | "image" | null {
  if (!type) return null;
  if ((VIDEO_TYPES as string[]).includes(type)) return "video";
  if ((IMAGE_TYPES as string[]).includes(type)) return "image";
  return null;
}
