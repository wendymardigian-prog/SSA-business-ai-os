/**
 * El chip "Vino de…" de la bandeja (Extra I, F44).
 *
 * Debajo de un mensaje ENTRANTE con origen, un chip chico dice de donde vino la persona:
 *   - «Vino de: Reel «3 errores…»»   (link a la pieza)
 *   - «Anuncio «Video testimonio»»    (link al detalle del anuncio SOLO si quien mira puede ver anuncios)
 *   - «Respuesta a tu historia»
 *   - «Te mencionó en una historia»
 *
 * No se repite en mensajes seguidos con el mismo origen: eso lo decide `originChipsFor` (origin-view.ts). Este modulo
 * solo arma el TEXTO y el LINK de cada chip a partir de datos que el servidor ya resolvio (una consulta por hilo, no una
 * por mensaje: `origin-chip-load.ts`).
 *
 * PURO y NUNCA lanza: un chip de menos no puede romper el hilo.
 */
import { adDetailHref } from "@/lib/meta/content-ad-summary";
import { pieceHref } from "@/lib/contacts/attribution-view";
import { originChipsFor, type ChipMessage, type MessageOrigin, type MessageOriginKind } from "@/lib/messages/origin-view";

/** El chip tal como viaja al navegador. */
export interface OriginChipView {
  kind: MessageOriginKind;
  /** Lo que se lee: "Vino de: Reel «3 errores…»". */
  text: string;
  /** A donde lleva. Null si no hay a donde (la pieza ya no esta, o quien mira no puede ver anuncios). */
  href: string | null;
}

/** Lo que el servidor leyo para resolver los chips de un hilo. */
export interface OriginLookup {
  /** `content_posts.id` -> titulo y formato. */
  pieces: ReadonlyMap<string, { title: string | null; format: string | null }>;
  /** `social_posts.id` -> la pieza a la que pertenece (si tiene), su texto y su tipo. */
  socialPosts: ReadonlyMap<string, { contentPostId: string | null; caption: string | null; mediaType: string | null }>;
  /** `meta_ads.ad_id` (el de Meta) -> su cuenta y su nombre en el catalogo. */
  ads: ReadonlyMap<string, { adAccountId: string; name: string | null }>;
}

/** Los ids que hay que ir a buscar para pintar los chips de un hilo. Solo cuentan los mensajes que SI llevan chip. */
export interface OriginRefs {
  contentPostIds: string[];
  socialPostIds: string[];
  adIds: string[];
}

const TITLE_MAX = 40;

const MEDIA_TYPE_LABELS: Record<string, string> = {
  reel: "Reel",
  video: "Video",
  short: "Short",
  story: "Historia",
  carousel: "Carrusel",
  image: "Imagen",
  text: "Texto",
  document: "Documento",
};

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** Corta con una elipsis sin partir una palabra a la mitad si se puede evitar. */
export function shortTitle(text: string | null | undefined, max = TITLE_MAX): string | null {
  const clean = squash(text ?? "");
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** El formato dicho en una palabra ("Reel", "Carrusel"). El de la pieza gana; si no, el tipo de la publicacion. */
export function formatWord(pieceFormat: string | null | undefined, mediaType: string | null | undefined): string | null {
  const fromPiece = squash(pieceFormat ?? "");
  if (fromPiece) return fromPiece.charAt(0).toUpperCase() + fromPiece.slice(1);
  const type = (mediaType ?? "").trim().toLowerCase();
  return MEDIA_TYPE_LABELS[type] ?? null;
}

/** Lo que hace falta buscar en la base para los chips de estos mensajes (solo los que llevan chip). */
export function originRefsFor(messages: readonly ChipMessage[]): OriginRefs {
  const content = new Set<string>();
  const social = new Set<string>();
  const ads = new Set<string>();
  try {
    for (const chip of originChipsFor(messages)) {
      const { origin } = chip;
      if (origin.contentPostId) content.add(origin.contentPostId);
      if (origin.socialPostId) social.add(origin.socialPostId);
      if (origin.adId) ads.add(origin.adId);
    }
  } catch {
    // Sin ids no hay consulta y los chips quedan con lo que trae el propio mensaje.
  }
  return { contentPostIds: [...content], socialPostIds: [...social], adIds: [...ads] };
}

function contentChip(origin: MessageOrigin, lookup: OriginLookup): OriginChipView {
  const social = origin.socialPostId ? lookup.socialPosts.get(origin.socialPostId) : undefined;
  // La pieza: la que trae el mensaje, o la de la publicacion.
  const pieceId = origin.contentPostId ?? social?.contentPostId ?? null;
  const piece = pieceId ? lookup.pieces.get(pieceId) : undefined;

  const word = formatWord(piece?.format, social?.mediaType);
  // El titulo de la pieza; si no esta, el texto de la publicacion; si no, el titulo que el propio mensaje guardo.
  const savedTitle = /«(.+)»/.exec(origin.label)?.[1] ?? null;
  const title = shortTitle(piece?.title) ?? shortTitle(social?.caption) ?? shortTitle(savedTitle);

  const subject = [word ?? (title ? "Publicación" : null), title ? `«${title}»` : null].filter(Boolean).join(" ");
  return {
    kind: "content",
    text: subject ? `Vino de: ${subject}` : "Vino de: una publicación",
    // Solo se linkea a una pieza que existe (si la borraron, el link rebotaria).
    href: pieceId && piece ? pieceHref(pieceId) : null,
  };
}

/**
 * Los chips de un hilo, por id de mensaje. `messages` va en el orden en que se dibuja (del mas viejo al mas nuevo).
 * Los mensajes que no estan en el resultado no llevan chip.
 */
export function originChipViews(
  messages: readonly ChipMessage[],
  lookup: OriginLookup,
  options: { canSeeAds: boolean },
): Record<string, OriginChipView> {
  const views: Record<string, OriginChipView> = {};
  try {
    for (const { messageId, origin } of originChipsFor(messages)) {
      try {
        if (origin.kind === "ad") {
          const ad = origin.adId ? lookup.ads.get(origin.adId) : undefined;
          // El nombre del catalogo solo lo sabe quien puede ver anuncios; los demas leen el titulo que trajo el mensaje.
          const catalogName = options.canSeeAds ? shortTitle(ad?.name, 60) : null;
          const text = origin.label !== "Anuncio" ? origin.label : catalogName ? `Anuncio «${catalogName}»` : "Anuncio";
          views[messageId] = {
            kind: "ad",
            text,
            href: options.canSeeAds && origin.adId && ad ? adDetailHref(origin.adId, ad.adAccountId) : null,
          };
        } else if (origin.kind === "content") {
          views[messageId] = contentChip(origin, lookup);
        } else {
          // Historia: si es nuestra, el contexto trae la pieza y el chip la linkea.
          const pieceId =
            origin.contentPostId ?? (origin.socialPostId ? (lookup.socialPosts.get(origin.socialPostId)?.contentPostId ?? null) : null);
          views[messageId] = {
            kind: origin.kind,
            text: origin.label,
            href: pieceId && lookup.pieces.has(pieceId) ? pieceHref(pieceId) : null,
          };
        }
      } catch {
        // Un mensaje con un contexto raro se queda sin chip; los demas siguen.
      }
    }
  } catch {
    // Un chip de menos nunca rompe el hilo.
  }
  return views;
}
