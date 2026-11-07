/**
 * Los links dentro del texto de un mensaje: que se pinta como link y a donde lleva.
 *
 * Reconoce `http(s)://…` y `www.…` (lo que cualquier app de chat vuelve clicable). Un dominio suelto ("hola.com") no:
 * "gracias.nos vemos" se volveria un link. Solo produce `http` y `https`, asi que un `javascript:` nunca llega a un `href`.
 *
 * Modulo PURO: lo usan la bandeja (navegador) y los emails (servidor). Sin lookbehind en la expresion regular: en un
 * Safari viejo es un error de sintaxis y tira abajo la pagina entera.
 */
import { isChatLink, splitTrailingPunctuation } from "@/lib/attribution/link-params";

export type TextSegment = { type: "text"; value: string } | { type: "link"; value: string; href: string };

const LINK_IN_TEXT = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
/** `www.` necesita un dominio despues: "www.hola" no es un link. */
const WWW_WITH_DOMAIN = /^www\.[^\s/?#]+\.[a-z]{2,}/i;
/** Marcas de formato de WhatsApp que pueden quedar pegadas al final: `*https://a.com*`. */
const FORMAT_MARKS = "*_~";

/** Le saca la puntuacion final y, si el link viene envuelto en una marca de formato, tambien esa marca. */
function cleanMatch(match: string, previousChar: string): { url: string; tail: string } {
  let { url, tail } = splitTrailingPunctuation(match);
  if (previousChar && FORMAT_MARKS.includes(previousChar) && url.endsWith(previousChar)) {
    const inner = splitTrailingPunctuation(url.slice(0, -1));
    url = inner.url;
    tail = inner.tail + previousChar + tail;
  }
  return { url, tail };
}

function hrefFor(url: string): string | null {
  const href = /^www\./i.test(url) ? `https://${url}` : url;
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? href : null;
  } catch {
    return null;
  }
}

/** Parte un texto en pedazos de texto y links. Unir los `value` da exactamente el texto original. */
export function splitTextLinks(text: string | null | undefined): TextSegment[] {
  if (typeof text !== "string" || text === "") return [];
  const segments: TextSegment[] = [];
  let plain = "";

  let cursor = 0;
  for (const found of text.matchAll(LINK_IN_TEXT)) {
    const start = found.index;
    const previousChar = start > 0 ? text[start - 1] : "";
    const isWww = /^www\./i.test(found[0]);
    const { url, tail } = cleanMatch(found[0], previousChar);
    const href = url ? hrefFor(url) : null;
    // "awww.hola.com" no es un link: el `www.` tiene que arrancar una palabra.
    const validWww = !isWww || (!/[\p{L}\p{N}]/u.test(previousChar) && WWW_WITH_DOMAIN.test(url));
    if (!href || !validWww) continue;

    plain += text.slice(cursor, start);
    if (plain) segments.push({ type: "text", value: plain });
    segments.push({ type: "link", value: url, href });
    plain = tail;
    cursor = start + found[0].length;
  }
  plain += text.slice(cursor);
  if (plain) segments.push({ type: "text", value: plain });
  return segments;
}

/**
 * El destino de un link medido (`/l/<token>`), leido sin verificar la firma; `null` si no es uno.
 *
 * Solo sirve para mensajes SALIENTES: que alguien del equipo toque el link en su propia bandeja no es un clic del lead.
 * En un entrante no se usa nunca, porque un lead podria armar un token falso y mostrar un destino distinto del real.
 * El formato es el de `lib/attribution/tracked-link.ts`, que no se puede importar aca porque usa `node:crypto`; un test
 * compara los dos.
 */
export function trackedLinkDestination(url: string): string | null {
  try {
    const match = /^\/l\/([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/.exec(new URL(url).pathname);
    if (!match) return null;
    const base64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { v?: unknown; u?: unknown };
    return payload?.v === 1 && typeof payload.u === "string" && /^https?:\/\//i.test(payload.u) ? payload.u : null;
  } catch {
    return null;
  }
}

/** A donde lleva un link de un mensaje: en un saliente medido, directo al destino; en cualquier otro caso, a lo escrito. */
export function messageLinkHref(href: string, outbound: boolean): string {
  return outbound ? (trackedLinkDestination(href) ?? href) : href;
}

/** Los pedazos de un mensaje, con cada link apuntando a donde tiene que llevar. */
export function messageSegments(text: string | null | undefined, outbound: boolean): TextSegment[] {
  return splitTextLinks(text).map((segment) => (segment.type === "link" ? { ...segment, href: messageLinkHref(segment.href, outbound) } : segment));
}

/**
 * El link de un mensaje que merece una tarjeta de vista previa: el primero que no sea de un chat (`wa.me`, `instagram.com`).
 * Como WhatsApp, una tarjeta por mensaje.
 */
export function firstPreviewableLink(text: string | null | undefined, outbound: boolean): string | null {
  for (const segment of messageSegments(text, outbound)) {
    if (segment.type === "link" && !isChatLink(segment.href)) return segment.href;
  }
  return null;
}

/** El texto convertido en HTML con links de verdad. `escape` es el del llamador: cada email tiene el suyo. */
export function linkifyToHtml(text: string, escape: (value: string) => string): string {
  return splitTextLinks(text)
    .map((segment) => (segment.type === "link" ? `<a href="${escape(segment.href)}" target="_blank" rel="noopener noreferrer">${escape(segment.value)}</a>` : escape(segment.value)))
    .join("");
}
