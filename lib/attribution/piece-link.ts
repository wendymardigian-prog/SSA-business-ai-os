/**
 * El generador de links de una pieza (Extra I, F42): un link con los parámetros de atribución de la pieza, para pegarlo en
 * una bio, un comentario fijado o un post. Es un link SIN seguimiento (no hay contacto ni clic registrado): solo agrega los
 * UTM. Modulo PURO; las reglas de armado son las de `buildAttributedUrl`.
 */
import { buildAttributedUrl, isChatLink } from "./link-params";

export const PIECE_LINK_PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "threads", label: "Threads" },
  { value: "facebook", label: "Facebook" },
] as const;

export type PieceLinkPlatform = (typeof PIECE_LINK_PLATFORMS)[number]["value"];

/** El `utm_medium` de un link para poner en una red (no en un mensaje directo). */
export const PIECE_LINK_MEDIUM = "organic_social";

export type PieceLinkResult =
  | { ok: true; url: string; /** El link ya traía todos los parámetros: sale igual que entró. */ unchanged: boolean }
  | { ok: false; error: string };

export interface PieceLinkInput {
  url: string;
  platform: string;
  pieceTitle: string | null | undefined;
  contentCode: string | null | undefined;
}

/** Valida el destino: texto no vacío, una URL que se pueda leer y `http(s)`. */
export function validateDestination(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const url = (raw ?? "").trim();
  if (!url) return { ok: false, error: "Pegá el link de destino." };
  if (/\s/.test(url)) return { ok: false, error: "El link no puede tener espacios." };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "No parece un link. Tiene que empezar con https:// o http://." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Solo se pueden usar links que empiecen con https:// o http://." };
  }
  if (!parsed.hostname) return { ok: false, error: "Al link le falta el dominio." };
  return { ok: true, url };
}

/** El link de destino con los parámetros de la pieza. */
export function composePieceLink(input: PieceLinkInput): PieceLinkResult {
  const destination = validateDestination(input.url);
  if (!destination.ok) return destination;

  const platform = PIECE_LINK_PLATFORMS.find((p) => p.value === input.platform);
  if (!platform) return { ok: false, error: "Elegí la red donde vas a poner el link." };

  const code = (input.contentCode ?? "").trim();
  if (!code) return { ok: false, error: "Esta pieza todavía no tiene código de atribución." };

  const out = buildAttributedUrl(destination.url, {
    platform: platform.value,
    flowName: input.pieceTitle,
    flowId: null,
    contentCode: code,
    medium: PIECE_LINK_MEDIUM,
  });

  if (out === destination.url) {
    // `buildAttributedUrl` devuelve el link igual por dos motivos: ya traía todo, o es un link de chat.
    if (isChatLink(destination.url)) {
      return {
        ok: false,
        error: "Los links de chat (wa.me, m.me, instagram.com) no llevan parámetros: no son un destino sino una conversación.",
      };
    }
    return { ok: true, url: out, unchanged: true };
  }
  return { ok: true, url: out, unchanged: false };
}
