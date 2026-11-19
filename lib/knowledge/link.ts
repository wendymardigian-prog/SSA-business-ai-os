/**
 * Un enlace como documento de la base.
 *
 * Se baja la página con `safeFetch` (solo direcciones públicas en cada salto,
 * corte por tiempo y por tamaño) y se convierte a Markdown. Esa "foto" se guarda
 * en el bucket como un `.md` más: así el enlace usa el mismo camino que un
 * archivo subido (cola, pendientes, reprocesar). Volver a leerlo reemplaza la
 * foto y retira los trozos viejos.
 *
 * Nunca se loguea el contenido de la página.
 */
import { BlockedUrlError, safeFetch } from "@/lib/net/safe-fetch";

export const LINK_MAX_URL_LENGTH = 2000;
export const LINK_MAX_BYTES = 2 * 1024 * 1024;
export const LINK_TIMEOUT_MS = 15_000;
const LINK_USER_AGENT = "Mozilla/5.0 (compatible; KnowledgeBot/1.0)";

export type LinkUrlCheck = { ok: true; url: string } | { ok: false; error: string };

/** Forma de la dirección, sin salir a la red. La comprobación de IP pública la hace `safeFetch`. */
export function normalizeLinkUrl(raw: string): LinkUrlCheck {
  const value = raw.trim();
  if (!value) return { ok: false, error: "Escribí la dirección del enlace." };
  if (value.length > LINK_MAX_URL_LENGTH) return { ok: false, error: "La dirección es demasiado larga." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, error: "La dirección no es válida." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Solo se admiten direcciones http o https." };
  if (url.username || url.password) return { ok: false, error: "La dirección no puede llevar usuario ni contraseña." };
  url.hash = "";
  return { ok: true, url: url.toString() };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", hellip: "…", mdash: "—", ndash: "–" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** El `<title>` de la página, o null. */
export function htmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
  return title ? title.slice(0, 200) : null;
}

/**
 * HTML a Markdown simple: títulos, párrafos, listas y saltos. Fuera scripts,
 * estilos, navegación, cabecera, pie y formularios. Puro, sin red.
 */
export function htmlToMarkdown(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|template|svg|iframe|nav|header|footer|form|aside)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(s);
  if (body) s = body[1];
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}\n\n`);
  s = s.replace(/<li[^>]*>/gi, "\n- ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|article|li|ul|ol|table|tr|blockquote|pre|main)\s*>/gi, "\n\n");
  s = s.replace(/<(td|th)[^>]*>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  const lines = s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""));
  return lines
    .join("\n")
    .replace(/ +([.,;:!?)])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^- $/gm, "")
    .trim();
}

export type LinkFetchResult =
  | { ok: true; url: string; title: string | null; markdown: string; truncated: boolean }
  | { ok: false; error: string };

export async function fetchLinkAsMarkdown(rawUrl: string, options: { fetchImpl?: typeof fetch; checkUrl?: (url: string) => Promise<URL> } = {}): Promise<LinkFetchResult> {
  const checked = normalizeLinkUrl(rawUrl);
  if (!checked.ok) return checked;
  let response;
  try {
    response = await safeFetch(
      checked.url,
      { method: "GET", headers: { "user-agent": LINK_USER_AGENT, accept: "text/html, text/plain, text/markdown;q=0.9" } },
      { timeoutMs: LINK_TIMEOUT_MS, maxBytes: LINK_MAX_BYTES, fetchImpl: options.fetchImpl, checkUrl: options.checkUrl },
    );
  } catch (err) {
    if (err instanceof BlockedUrlError) return { ok: false, error: "Esa dirección no se puede leer desde aquí (no es pública)." };
    console.error("[kb] no pude leer el enlace:", err instanceof Error ? err.name : "error");
    return { ok: false, error: "No se pudo leer la página. Revisá la dirección o probá más tarde." };
  }
  if (!response.ok) return { ok: false, error: `La página respondió con un error (${response.status}).` };
  const type = response.contentType;
  let markdown: string;
  let title: string | null = null;
  if (type === "text/html" || type === "application/xhtml+xml" || (!type && /<html|<body/i.test(response.text))) {
    title = htmlTitle(response.text);
    markdown = htmlToMarkdown(response.text);
  } else if (type === "text/plain" || type === "text/markdown") {
    markdown = response.text.trim();
  } else {
    return { ok: false, error: "Esa dirección no es una página de texto. Si es un PDF o un Word, descárgalo y súbelo como archivo." };
  }
  if (!markdown) return { ok: false, error: "La página no tiene texto que leer." };
  return { ok: true, url: response.finalUrl, title, markdown, truncated: response.truncated };
}
