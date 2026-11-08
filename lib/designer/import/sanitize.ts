/**
 * Limpiar el HTML de un archivo cargado (F40).
 *
 * TODO el HTML que viene de afuera pasa por acá, en el servidor, antes de entrar a un diseño; y
 * vuelve a pasar cada vez que se guarda (una edición de la persona o un parche de la IA no
 * pueden meter nada ejecutable). El render (`renderPageHTML`) tiene su propia limpieza
 * defensiva aparte; esta es la que cuenta.
 *
 * Se quita: `<script>`, `<iframe>` (YouTube y Vimeo pasan a una imagen con el link), `<object>`,
 * `<embed>`, `<base>`, `<meta http-equiv>`, `<link>`, comentarios, los atributos `on*`, `srcdoc`,
 * `javascript:` y `data:` que no sea una imagen. Un `<form>` queda como un bloque visual (un `div`;
 * los campos son de adorno: ningún botón envía nada). Todo lo que se quita se cuenta para el aviso.
 *
 * Usa `sanitize-html` con una lista cerrada de etiquetas y atributos. Los estilos y el CSS pasan por
 * `css.ts`. Módulo puro (sin DOM, sin red).
 */

import sanitizeHtml from "sanitize-html";
import { sanitizeStyleAttribute, type AssetRef } from "./css";
import { tokenizeHtml } from "./html-scan";

export interface RemovedCounts {
  scripts: number;
  iframes: number;
  forms: number;
  /** `object`, `embed`, `base`, `meta http-equiv`, manejadores `on*`, `javascript:`… */
  other: number;
  /** Videos de YouTube o Vimeo que pasaron a una imagen con el link (no se perdieron). */
  videos: number;
}

export interface SanitizeOptions {
  /**
   * Qué hacer con una dirección de imagen: el archivo del zip (→ `asset:<ruta>`), una imagen en línea
   * grande (→ `asset:`) o la misma si ya es nuestra. `null` = no se admite y el atributo se quita.
   */
  assetRef: AssetRef;
  /** Conservar los `data-tx` (al volver a limpiar algo que ya se importó). Al importar se quitan los que traiga el archivo. */
  keepMarks?: boolean;
}

export interface SanitizeResult {
  html: string;
  removed: RemovedCounts;
}

export const EMPTY_REMOVED: RemovedCounts = { scripts: 0, iframes: 0, forms: 0, other: 0, videos: 0 };

const BLOCK_TAGS = [
  "address", "article", "aside", "footer", "header", "h1", "h2", "h3", "h4", "h5", "h6", "hgroup", "main", "nav", "section",
  "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure", "hr", "li", "ol", "p", "pre", "ul", "center", "details", "summary",
];
const INLINE_TAGS = [
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby", "s", "samp",
  "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "del", "ins",
];
const TABLE_TAGS = ["caption", "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr"];
const MEDIA_TAGS = ["img", "picture", "source"];
/** Los controles quedan de adorno: sin `form`, no envían nada. */
const CONTROL_TAGS = ["label", "button", "input"];
/** SVG sin `use`, `image`, `foreignObject`, `animate*`, `set`, `style` ni filtros. */
const SVG_TAGS = [
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs", "stop", "mask", "pattern", "text", "tspan",
  // El lector conserva las mayúsculas dentro de un SVG; el HTML de salida se lee igual con las dos escrituras.
  "linearGradient", "radialGradient", "clipPath", "lineargradient", "radialgradient", "clippath",
];

export const ALLOWED_TAGS = [...BLOCK_TAGS, ...INLINE_TAGS, ...TABLE_TAGS, ...MEDIA_TAGS, ...CONTROL_TAGS, ...SVG_TAGS];

const SVG_ATTRS = [
  "viewbox", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
  "stroke-miterlimit", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "points", "transform", "opacity", "fill-opacity",
  "stroke-opacity", "fill-rule", "clip-rule", "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform", "clip-path", "mask",
  "preserveaspectratio", "xmlns", "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline", "dx", "dy", "patternunits",
  "patterntransform", "maskunits", "clippathunits", "fx", "fy",
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  "*": ["class", "id", "style", "title", "lang", "dir", "role", "aria-*", "data-*"],
  a: ["href", "target", "rel"],
  img: ["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding"],
  source: ["srcset", "sizes", "media", "type", "width", "height"],
  td: ["colspan", "rowspan", "align", "valign", "width", "height"],
  th: ["colspan", "rowspan", "align", "valign", "width", "height", "scope"],
  table: ["width", "height", "border", "cellpadding", "cellspacing", "align"],
  col: ["span", "width"],
  colgroup: ["span", "width"],
  ol: ["start", "reversed", "type"],
  li: ["value"],
  time: ["datetime"],
  q: ["cite"],
  blockquote: ["cite"],
  label: ["for"],
  button: ["type", "disabled"],
  input: ["type", "value", "placeholder", "checked", "disabled", "readonly", "min", "max", "step", "maxlength"],
  details: ["open"],
  ...Object.fromEntries(SVG_TAGS.map((tag) => [tag, SVG_ATTRS])),
};

/** Tags cuyo CONTENIDO también se descarta cuando la etiqueta no se admite. */
const NON_TEXT_TAGS = ["script", "style", "textarea", "option", "xmp", "noscript", "template", "iframe", "head", "title", "object", "embed", "noembed", "noframes", "applet", "frameset", "frame", "select"];

const INPUT_TYPES = new Set(["text", "email", "tel", "number", "search", "url", "date", "time", "checkbox", "radio", "range", "color", "button", "hidden"]);
const RESERVED_DATA = new Set(["data-el", "data-el-type", "data-page", "data-format", "data-var"]);
const TX_RE = /^tx\d{1,6}$/;
const IMAGE_DATA_RE = /^data:image\/(?:png|jpe?g|gif|webp);base64,/i;

/** La dirección sin los blancos y controles con los que se disfraza un esquema (`java\tscript:`). */
function normalizedForScheme(value: string): string {
  return value.replace(/[\u0000- \u007f-\u009f]+/g, "").toLowerCase();
}

function schemeOf(value: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):/.exec(normalizedForScheme(value));
  return m ? m[1] : null;
}

type UrlKind = "link" | "image";

/** Qué se hace con una dirección: la que queda, o `null` si se quita (con el aviso en `bad`). */
function cleanUrl(raw: string, kind: UrlKind, ref: AssetRef, bad: { n: number }): string | null {
  let value = raw.trim();
  if (value === "") return null;
  const scheme = schemeOf(value);
  if (kind === "link") {
    if (value.startsWith("#")) return /^#[^\s"'<>]*$/.test(value) ? value : null;
    if (value.startsWith("//")) value = `https:${value}`;
    if (scheme === null && !value.startsWith("https:")) return null; // un link relativo no apunta a ningún lado
    const s = value.startsWith("https:") ? "https" : scheme;
    if (s === "http" || s === "https" || s === "mailto" || s === "tel") return value;
    if (s === "javascript" || s === "vbscript" || s === "data") bad.n++;
    return null;
  }
  // image
  if (value.startsWith("//")) value = `https:${value}`;
  const s = value.startsWith("https:") ? "https" : scheme;
  if (s === "http" || s === "https") return value;
  if (s === "data") {
    if (!IMAGE_DATA_RE.test(value.replace(/[\u0000- ]+/g, ""))) {
      bad.n++;
      return null;
    }
    return ref(value.replace(/\s+/g, ""));
  }
  if (s === "asset") return ref(value);
  if (s !== null) {
    if (s === "javascript" || s === "vbscript") bad.n++;
    return null;
  }
  return ref(value); // relativa: un archivo del zip, o nada
}

function cleanSrcset(raw: string, ref: AssetRef, bad: { n: number }): string | null {
  const kept: string[] = [];
  for (const candidate of raw.split(/,\s+/)) {
    const parts = candidate.trim().split(/\s+/);
    if (!parts[0]) continue;
    const url = cleanUrl(parts[0], "image", ref, bad);
    if (url && !/[,\s]/.test(url.replace(/^data:[^,]*,/, ""))) kept.push([url, ...parts.slice(1)].join(" "));
  }
  return kept.length > 0 ? kept.join(", ") : null;
}

// ─── Videos incrustados ─────────────────────────────────────────────────────

const YOUTUBE_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com", "www.youtube-nocookie.com", "youtube-nocookie.com"]);
const VIDEO_STYLE = "display:block;width:100%;aspect-ratio:16/9;object-fit:cover";

/** Si un `iframe` es un video de YouTube o Vimeo, el reemplazo (una imagen con el link). */
function videoReplacement(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src.trim().startsWith("//") ? `https:${src.trim()}` : src.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (YOUTUBE_HOSTS.has(url.hostname) && parts[0] === "embed" && /^[A-Za-z0-9_-]{6,20}$/.test(parts[1] ?? "")) {
    const id = parts[1];
    return (
      `<a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">` +
      `<img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" alt="Video de YouTube" style="${VIDEO_STYLE}"></a>`
    );
  }
  if (url.hostname === "player.vimeo.com" && parts[0] === "video" && /^\d{4,12}$/.test(parts[1] ?? "")) {
    const id = parts[1];
    return (
      `<a href="https://vimeo.com/${id}" target="_blank" rel="noopener noreferrer">` +
      `<span style="${VIDEO_STYLE.replace("object-fit:cover", "background:#111;color:#fff;text-align:center;padding:12% 0;font-size:20px")}">&#9654; Ver el video en Vimeo</span></a>`
    );
  }
  return null;
}

/** Cambia los `iframe` de YouTube y Vimeo por una imagen con el link; los demás los saca la limpieza. */
function convertVideoIframes(html: string): { html: string; videos: number } {
  const tokens = tokenizeHtml(html);
  if (!tokens.some((t) => t.kind === "open" && t.name === "iframe")) return { html, videos: 0 };
  let out = "";
  let videos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "open" && t.name === "iframe") {
      const src = t.attrs.find((a) => a.name === "src")?.value ?? "";
      const replacement = videoReplacement(src);
      if (replacement) {
        let skipTo = i;
        for (let j = i + 1; j < tokens.length; j++) {
          if (tokens[j].kind === "close" && (tokens[j] as { name: string }).name === "iframe") {
            skipTo = j;
            break;
          }
        }
        out += replacement;
        videos++;
        i = skipTo;
        continue;
      }
    }
    out += t.raw;
  }
  return { html: out, videos };
}

// ─── Limpieza ───────────────────────────────────────────────────────────────

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Se quitaron 3 scripts y 1 formulario: se mantiene el diseño." (o `null` si no se quitó nada). */
export function removedSummary(removed: RemovedCounts): string | null {
  const parts: string[] = [];
  if (removed.scripts > 0) parts.push(plural(removed.scripts, "script", "scripts"));
  if (removed.iframes > 0) parts.push(plural(removed.iframes, "marco incrustado", "marcos incrustados"));
  if (removed.forms > 0) parts.push(plural(removed.forms, "formulario", "formularios"));
  if (removed.other > 0) parts.push(plural(removed.other, "elemento no permitido", "elementos no permitidos"));
  const sentences: string[] = [];
  if (parts.length > 0) {
    const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
    sentences.push(`Se quitaron ${list}: se mantiene el diseño.`);
  }
  if (removed.videos > 0) sentences.push(removed.videos === 1 ? "Un video de YouTube o Vimeo pasó a una imagen con su link." : `${removed.videos} videos de YouTube o Vimeo pasaron a una imagen con su link.`);
  return sentences.length > 0 ? sentences.join(" ") : null;
}

/**
 * Limpia el HTML de un archivo (o lo que se vuelve a guardar de uno ya cargado). Devuelve solo el
 * contenido del `<body>`, sin `html`, `head`, `body` ni `<style>`: el CSS se junta aparte.
 */
export function sanitizeImportedHtml(html: string, options: SanitizeOptions): SanitizeResult {
  const removed: RemovedCounts = { ...EMPTY_REMOVED };
  const converted = convertVideoIframes(html);
  removed.videos = converted.videos;
  const bad = { n: 0 };
  const ref = options.assetRef;

  const cleaned = sanitizeHtml(converted.html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto", "tel", "asset"],
    allowedSchemesByTag: { a: ["http", "https", "mailto", "tel"], img: ["http", "https", "asset", "data"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: NON_TEXT_TAGS,
    onOpenTag: (name, attribs) => {
      if (name === "script") removed.scripts++;
      else if (name === "iframe") removed.iframes++;
      else if (name === "form") removed.forms++;
      else if (["object", "embed", "applet", "base", "frame", "frameset", "noscript", "template", "noembed", "noframes"].includes(name)) removed.other++;
      else if (name === "meta" && Object.keys(attribs).some((a) => a.toLowerCase() === "http-equiv")) removed.other++;
      else if (name === "link") removed.other++;
      for (const attr of Object.keys(attribs)) {
        if (/^on/i.test(attr) || attr.toLowerCase() === "srcdoc") removed.other++;
      }
    },
    transformTags: {
      // Un formulario queda como un bloque visual.
      form: (_tag, attribs) => ({ tagName: "div", attribs }),
      "*": (tagName, attribs) => {
        const next: Record<string, string> = {};
        for (const [rawName, rawValue] of Object.entries(attribs)) {
          const name = rawName.toLowerCase();
          const value = rawValue ?? "";
          if (name.startsWith("on") || name === "srcdoc") continue;
          if (name === "style") {
            const style = sanitizeStyleAttribute(value, { assetRef: ref });
            bad.n += style.removed;
            if (style.style) next.style = style.style;
            continue;
          }
          if (name === "href" && tagName === "a") {
            const url = cleanUrl(value, "link", ref, bad);
            if (url) next.href = url;
            continue;
          }
          if (name === "src" && (tagName === "img")) {
            const url = cleanUrl(value, "image", ref, bad);
            if (url) next.src = url;
            continue;
          }
          if (name === "srcset" && (tagName === "img" || tagName === "source")) {
            const set = cleanSrcset(value, ref, bad);
            if (set) next.srcset = set;
            continue;
          }
          if (name === "href" || name === "src" || name === "srcset" || name === "xlink:href" || name === "action" || name === "formaction" || name === "poster" || name === "background") continue;
          if (name === "data-tx") {
            if (options.keepMarks && TX_RE.test(value)) next[name] = value;
            continue;
          }
          if (RESERVED_DATA.has(name)) continue;
          if (name === "target") {
            if (value.toLowerCase() === "_blank") next.target = "_blank";
            continue;
          }
          // Cualquier otro valor que traiga un esquema ejecutable se descarta.
          const probe = normalizedForScheme(value);
          if (/javascript:|vbscript:|livescript:|expression\(/.test(probe) || (/url\(/.test(probe) && !/url\(#/.test(probe))) {
            bad.n++;
            continue;
          }
          next[name] = value;
        }
        if (tagName === "a" && next.target === "_blank") next.rel = "noopener noreferrer";
        else if (tagName === "a") delete next.rel;
        if (tagName === "button") next.type = "button";
        if (tagName === "input") {
          const type = (next.type ?? "text").toLowerCase();
          if (type === "submit" || type === "reset" || type === "image") next.type = "button";
          else next.type = INPUT_TYPES.has(type) ? type : "text";
        }
        return { tagName, attribs: next };
      },
    },
  });

  removed.other += bad.n;
  return { html: cleaned, removed };
}
