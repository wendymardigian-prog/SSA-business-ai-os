/**
 * Lo que una pagina declara para compartirse: titulo, descripcion e imagen (`og:` y `twitter:`, con `<title>` de respaldo).
 *
 * Sin titulo no hay tarjeta. Una imagen solo vale si es `https` (la pinta el navegador directo, sin contenido mixto).
 *
 * Modulo PURO, sin dependencias: lee texto con expresiones regulares y nunca arma HTML con lo que lee. React escapa lo
 * que se pinta. Nunca lanza.
 */

export interface LinkPreview {
  title: string;
  description: string | null;
  image: string | null;
  siteName: string;
}

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 200;
const MAX_SITE = 60;
const MAX_IMAGE_URL = 2000;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
    const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    try {
      return String.fromCodePoint(value);
    } catch {
      return whole;
    }
  });
}

/** Sin saltos ni espacios de mas, y cortado por caracteres (no parte un emoji al medio). */
function clean(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const compact = decodeEntities(text).replace(/\s+/g, " ").trim();
  if (!compact) return null;
  const chars = Array.from(compact);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : compact;
}

function readAttr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

/** Las etiquetas `<meta>`: clave (`property` o `name`, en minusculas) → contenido. Gana la primera de cada clave. */
function readMetaTags(head: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const [tag] of head.matchAll(/<meta\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)) {
    const key = (readAttr(tag, "property") ?? readAttr(tag, "name"))?.toLowerCase();
    const content = readAttr(tag, "content");
    if (key && content && !tags.has(key)) tags.set(key, content);
  }
  return tags;
}

function imageUrl(raw: string | undefined, pageUrl: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(decodeEntities(raw).trim(), pageUrl);
    return url.protocol === "https:" && url.href.length <= MAX_IMAGE_URL ? url.href : null;
  } catch {
    return null;
  }
}

function hostOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function parseLinkPreview(html: string, pageUrl: string): LinkPreview | null {
  if (typeof html !== "string" || html === "") return null;
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd === -1 ? html : html.slice(0, headEnd);
  const tags = readMetaTags(head);

  const title = clean(tags.get("og:title") ?? tags.get("twitter:title") ?? /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1], MAX_TITLE);
  if (!title) return null;

  return {
    title,
    description: clean(tags.get("og:description") ?? tags.get("twitter:description") ?? tags.get("description"), MAX_DESCRIPTION),
    image: imageUrl(tags.get("og:image:secure_url") ?? tags.get("og:image") ?? tags.get("twitter:image") ?? tags.get("twitter:image:src"), pageUrl),
    siteName: clean(tags.get("og:site_name"), MAX_SITE) ?? hostOf(pageUrl),
  };
}
