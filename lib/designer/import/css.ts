/**
 * El CSS de un archivo HTML cargado (F40).
 *
 * Conserva los estilos y nada que pueda ejecutar o cargar algo de afuera:
 *   - sin `@import` salvo Google Fonts;
 *   - sin `url()` fuera de los recursos del propio archivo (que pasan a `asset:<ruta>`),
 *     de Google Fonts, de un `#ancla` o de una imagen en línea (PNG, JPG, GIF o WebP);
 *   - sin `expression()`, `javascript:`, `behavior`, `-moz-binding`, `image-set()`, `src()`;
 *   - `position: fixed` pasa a `absolute` (un diseño no puede pegarse a la ventana);
 *   - `html`, `body` y `:root` pasan a `.dz-import` (la caja donde vive el diseño cargado).
 *
 * Nunca se escribe el valor "decodificado": los escapes de CSS (`\6a avascript`) se
 * decodifican solo para MIRAR, y lo que se guarda es el texto original o nada.
 *
 * Módulo puro (sin DOM, sin red).
 */

export const IMPORT_ROOT_CLASS = "dz-import";

/**
 * Lo primero del CSS de un archivo cargado: el render pone un reinicio global (`*{margin:0;padding:0;box-sizing:border-box}`)
 * que no estaba en el archivo. Esta regla le devuelve a lo cargado los márgenes y rellenos del navegador y su
 * `content-box`; con `:where()` pesa cero, así que cualquier regla del propio archivo le gana.
 */
export const IMPORT_BASE_CSS = `:where(.${IMPORT_ROOT_CLASS}) *{margin:revert;padding:revert;box-sizing:content-box;}`;

export interface CssDecl {
  kind: "decl";
  prop: string;
  value: string;
  important: boolean;
}
export interface CssRule {
  kind: "rule";
  selector: string;
  items: CssItem[];
}
export interface CssAtRule {
  kind: "at";
  name: string;
  prelude: string;
  /** `null` = una sentencia que termina en `;` (como `@import`). */
  items: CssItem[] | null;
}
export type CssItem = CssDecl | CssRule | CssAtRule;

/** Decodifica los escapes de CSS (`\6a`, `\n`) para poder MIRAR el texto; nunca se usa para escribir. */
export function unescapeCss(text: string): string {
  return text.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|(\r\n|[\s\S]))/g, (_m, hex: string | undefined, other: string | undefined) => {
    if (hex) {
      const code = parseInt(hex, 16);
      if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(code);
    }
    return other === "\n" || other === "\r\n" ? "" : (other ?? "");
  });
}

// ─── Lector ─────────────────────────────────────────────────────────────────

function skipComment(css: string, i: number): number {
  const end = css.indexOf("*/", i + 2);
  return end === -1 ? css.length : end + 2;
}

function skipString(css: string, i: number): number {
  const quote = css[i];
  let j = i + 1;
  while (j < css.length) {
    if (css[j] === "\\") {
      j += 2;
      continue;
    }
    if (css[j] === quote) return j + 1;
    if (css[j] === "\n") return j; // una cadena sin cerrar termina en el salto de línea
    j++;
  }
  return css.length;
}

/** Avanza hasta uno de `stops` fuera de cadenas, paréntesis, corchetes y comentarios. */
function scanTo(css: string, from: number, stops: string): number {
  let i = from;
  let depth = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      i = skipComment(css, i);
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    else if (depth === 0 && stops.includes(ch)) return i;
    i++;
  }
  return css.length;
}

function stripCommentsIn(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "/" && text[i + 1] === "*") {
      i = skipComment(text, i);
      out += " ";
      continue;
    }
    if (text[i] === '"' || text[i] === "'") {
      const end = skipString(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    out += text[i];
    i++;
  }
  return out.trim();
}

const MAX_DEPTH = 8;

function parseItems(css: string, start: number, depth: number): { items: CssItem[]; end: number } {
  const items: CssItem[] = [];
  let i = start;
  while (i < css.length) {
    const ch = css[i];
    if (/\s/.test(ch) || ch === ";") {
      i++;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      i = skipComment(css, i);
      continue;
    }
    if (css.startsWith("<!--", i)) {
      i += 4;
      continue;
    }
    if (css.startsWith("-->", i)) {
      i += 3;
      continue;
    }
    if (ch === "}") return { items, end: i + 1 };
    if (ch === "@") {
      let j = i + 1;
      while (j < css.length && /[-\w]/.test(css[j])) j++;
      const name = css.slice(i + 1, j).toLowerCase();
      const stop = scanTo(css, j, ";{}");
      const prelude = stripCommentsIn(css.slice(j, stop));
      if (css[stop] === "{") {
        if (depth >= MAX_DEPTH) {
          const skipped = skipBlock(css, stop + 1);
          i = skipped;
          continue;
        }
        const inner = parseItems(css, stop + 1, depth + 1);
        items.push({ kind: "at", name, prelude, items: inner.items });
        i = inner.end;
      } else {
        items.push({ kind: "at", name, prelude, items: null });
        i = css[stop] === ";" ? stop + 1 : stop;
      }
      continue;
    }
    const stop = scanTo(css, i, ";{}");
    const head = css.slice(i, stop);
    if (css[stop] === "{") {
      if (depth >= MAX_DEPTH) {
        i = skipBlock(css, stop + 1);
        continue;
      }
      const inner = parseItems(css, stop + 1, depth + 1);
      items.push({ kind: "rule", selector: stripCommentsIn(head), items: inner.items });
      i = inner.end;
      continue;
    }
    const text = stripCommentsIn(head);
    const colon = text.indexOf(":");
    if (colon > 0) {
      let value = text.slice(colon + 1).trim();
      let important = false;
      const imp = /\s*!\s*important\s*$/i.exec(value);
      if (imp) {
        important = true;
        value = value.slice(0, imp.index).trim();
      }
      items.push({ kind: "decl", prop: text.slice(0, colon).trim(), value, important });
    }
    i = css[stop] === ";" ? stop + 1 : stop;
  }
  return { items, end: css.length };
}

function skipBlock(css: string, from: number): number {
  let i = from;
  let depth = 1;
  while (i < css.length && depth > 0) {
    const stop = scanTo(css, i, "{}");
    if (stop >= css.length) return css.length;
    depth += css[stop] === "{" ? 1 : -1;
    i = stop + 1;
  }
  return i;
}

/** Lee una hoja de estilos (con tope de anidación). Nunca lanza. */
export function parseCss(css: string): CssItem[] {
  return parseItems(css, 0, 0).items;
}

export function serializeCss(items: readonly CssItem[]): string {
  const one = (item: CssItem): string => {
    if (item.kind === "decl") return `${item.prop}:${item.value}${item.important ? " !important" : ""};`;
    if (item.kind === "rule") return `${item.selector}{${item.items.map(one).join("")}}`;
    const head = `@${item.name}${item.prelude ? ` ${item.prelude}` : ""}`;
    return item.items === null ? `${head};` : `${head}{${item.items.map(one).join("")}}`;
  };
  return items.map(one).join("\n");
}

// ─── Limpieza ───────────────────────────────────────────────────────────────

/**
 * Qué hacer con una dirección que aparece en el CSS. Devuelve la dirección ya lista para
 * escribir (`asset:<ruta>` o la misma), o `null` si no se admite.
 */
export type AssetRef = (url: string) => string | null;

export interface CssCleanOptions {
  assetRef: AssetRef;
  /** `html`, `body` y `:root` pasan a `.dz-import` (lo que se hace al cargar). Con `false`, no se tocan los selectores. */
  scopeRoot?: boolean;
}

export interface CssCleanResult {
  css: string;
  /** Cuántas reglas, declaraciones o `@import` se quitaron. */
  removed: number;
}

const GOOGLE_STYLES = "https://fonts.googleapis.com/";
const GOOGLE_FILES = "https://fonts.gstatic.com/";
const SAFE_URL_RE = /^[A-Za-z0-9:/._?=&%+,@;|~!$*-]+$/;
const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]*$/i;

const ALLOWED_AT_BLOCKS = new Set(["media", "supports", "layer", "container", "font-face", "keyframes", "-webkit-keyframes", "page", "property", "counter-style"]);

/** Una dirección de Google Fonts (hoja de estilos o archivo de fuente). */
export function isGoogleFontsUrl(url: string): boolean {
  const u = url.trim();
  return (u.startsWith(GOOGLE_STYLES) || u.startsWith(GOOGLE_FILES)) && SAFE_URL_RE.test(u);
}

/** Si una dirección de `url()` se admite y a qué se escribe. */
function resolveCssUrl(raw: string, ref: AssetRef): string | null {
  const url = unescapeCss(raw).trim();
  if (url === "") return null;
  if (url.startsWith("#")) return /^#[A-Za-z0-9_-]+$/.test(url) ? url : null;
  if (isGoogleFontsUrl(url)) return url;
  if (DATA_IMAGE_RE.test(url)) {
    const mapped = ref(url.replace(/\s+/g, ""));
    return mapped;
  }
  const mapped = ref(url);
  return mapped !== null && mapped.startsWith("asset:") ? mapped : null;
}

/** Las `url(...)` de un valor, con dónde empiezan y terminan. */
function findUrls(value: string): { start: number; end: number; arg: string }[] {
  const found: { start: number; end: number; arg: string }[] = [];
  const re = /url\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    let i = match.index + match[0].length;
    while (i < value.length && /\s/.test(value[i])) i++;
    let arg: string;
    let end: number;
    if (value[i] === '"' || value[i] === "'") {
      const stop = skipString(value, i);
      arg = value.slice(i + 1, Math.max(i + 1, stop - 1));
      end = value.indexOf(")", stop);
    } else {
      let j = i;
      while (j < value.length && value[j] !== ")") {
        if (value[j] === "\\") j++;
        j++;
      }
      arg = value.slice(i, j).trim();
      end = j < value.length ? j : -1;
    }
    if (end === -1) {
      found.push({ start: match.index, end: value.length, arg: "" });
      break;
    }
    found.push({ start: match.index, end: end + 1, arg });
    re.lastIndex = end + 1;
  }
  return found;
}

const FORBIDDEN_VALUE_RE = /expression\s*\(|javascript\s*:|vbscript\s*:|livescript\s*:|-moz-binding|behavior\s*:|@import|<|(?:^|[^a-z0-9_-])(?:-webkit-)?(?:image-set|cross-fade|src|element|paint)\s*\(/i;
const PROP_RE = /^-{0,2}[A-Za-z][A-Za-z0-9_-]*$/;

/** Limpia el valor de una propiedad; `null` si hay que quitar la declaración entera. */
function cleanValue(prop: string, value: string, ref: AssetRef, inFontFace: boolean): string | null {
  const decoded = unescapeCss(value);
  if (FORBIDDEN_VALUE_RE.test(decoded)) return null;
  const urls = findUrls(value);
  // Una `url(` disfrazada con escapes (`u\72l(`) no aparece al leer el original: se descarta.
  const decodedUrlCount = (decoded.match(/url\s*\(/gi) ?? []).length;
  if (decodedUrlCount !== urls.length) return null;
  if (urls.length === 0) return value;
  if (inFontFace && prop === "src") {
    const parts = splitTopLevel(value, ",");
    const kept: string[] = [];
    for (const part of parts) {
      const cleaned = replaceUrls(part, ref);
      if (cleaned !== null) kept.push(cleaned.trim());
    }
    return kept.length > 0 ? kept.join(", ") : null;
  }
  return replaceUrls(value, ref);
}

function replaceUrls(value: string, ref: AssetRef): string | null {
  const urls = findUrls(value);
  let out = "";
  let last = 0;
  for (const u of urls) {
    const resolved = resolveCssUrl(u.arg, ref);
    if (resolved === null) return null;
    if (/["\\\n\r()<>]/.test(resolved) || /\s/.test(resolved) && !resolved.startsWith("data:")) return null;
    out += value.slice(last, u.start) + `url("${resolved}")`;
    last = u.end;
  }
  return out + value.slice(last);
}

function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let from = 0;
  while (from <= text.length) {
    const stop = scanTo(text, from, sep);
    parts.push(text.slice(from, stop));
    if (stop >= text.length) break;
    from = stop + 1;
  }
  return parts;
}

/** `html`, `body` y `:root` → `.dz-import` en cada selector de la lista. */
export function scopeRootSelectors(selector: string): string {
  let out = selector.replace(/(^|[\s>+~,(])(?:html|body|:root)(?![\w-])/gi, `$1.${IMPORT_ROOT_CLASS}`);
  const doubled = new RegExp(`\\.${IMPORT_ROOT_CLASS}(?:\\s*[>+~]?\\s+)\\.${IMPORT_ROOT_CLASS}(?![\\w-])`, "g");
  let prev: string;
  do {
    prev = out;
    out = out.replace(doubled, `.${IMPORT_ROOT_CLASS}`);
  } while (out !== prev);
  // `html, body { … }` queda como una sola vez `.dz-import`.
  let seenRoot = false;
  return out
    .split(",")
    .map((part) => part.trim())
    .filter((part) => {
      if (part !== `.${IMPORT_ROOT_CLASS}`) return part !== "";
      if (seenRoot) return false;
      seenRoot = true;
      return true;
    })
    .join(",");
}

interface Ctx {
  ref: AssetRef;
  scopeRoot: boolean;
  removed: number;
  inFontFace: boolean;
  /** Dentro de un `@keyframes`, `@font-face` o `@page`: los selectores no son de la página. */
  rawSelectors: boolean;
}

function cleanDecl(item: CssDecl, ctx: Ctx): CssDecl | null {
  const prop = item.prop;
  if (!PROP_RE.test(prop) || /binding|behavio(?:u)?r/i.test(prop)) {
    ctx.removed++;
    return null;
  }
  let value = item.value;
  if (prop.toLowerCase() === "position" && /^fixed$/i.test(value.trim())) value = "absolute";
  const cleaned = cleanValue(prop.toLowerCase(), value, ctx.ref, ctx.inFontFace);
  if (cleaned === null) {
    ctx.removed++;
    return null;
  }
  return { kind: "decl", prop, value: cleaned, important: item.important };
}

function cleanItems(items: readonly CssItem[], ctx: Ctx): CssItem[] {
  const out: CssItem[] = [];
  for (const item of items) {
    if (item.kind === "decl") {
      const decl = cleanDecl(item, ctx);
      if (decl) out.push(decl);
      continue;
    }
    if (item.kind === "rule") {
      if (/[<{}]/.test(unescapeCss(item.selector)) || item.selector === "") {
        ctx.removed++;
        continue;
      }
      const selector = ctx.scopeRoot && !ctx.rawSelectors ? scopeRootSelectors(item.selector) : item.selector;
      const inner = cleanItems(item.items, ctx);
      if (inner.length > 0) out.push({ kind: "rule", selector, items: inner });
      continue;
    }
    if (item.name === "import") {
      const imported = cleanImport(item.prelude);
      if (imported) out.push({ kind: "at", name: "import", prelude: imported, items: null });
      else ctx.removed++;
      continue;
    }
    if (item.items === null || !ALLOWED_AT_BLOCKS.has(item.name) || /[<]/.test(unescapeCss(item.prelude))) {
      ctx.removed++;
      continue;
    }
    const raw = item.name === "font-face" || item.name === "page" || item.name.endsWith("keyframes") || item.name === "counter-style" || item.name === "property";
    const inner: Ctx = { ...ctx, inFontFace: item.name === "font-face", rawSelectors: ctx.rawSelectors || raw };
    const kept = cleanItems(item.items, inner);
    ctx.removed = inner.removed;
    if (kept.length > 0) out.push({ kind: "at", name: item.name, prelude: item.prelude, items: kept });
  }
  return out;
}

/** `@import url("https://fonts.googleapis.com/...")` y nada más. */
function cleanImport(prelude: string): string | null {
  const urls = findUrls(prelude);
  let url: string | null = null;
  let rest = "";
  if (urls.length === 1 && prelude.trimStart().toLowerCase().startsWith("url")) {
    url = unescapeCss(urls[0].arg).trim();
    rest = prelude.slice(urls[0].end);
  } else {
    const m = /^\s*(["'])(.*?)\1([\s\S]*)$/.exec(prelude);
    if (m) {
      url = unescapeCss(m[2]).trim();
      rest = m[3];
    }
  }
  if (!url || !url.startsWith(GOOGLE_STYLES) || !isGoogleFontsUrl(url)) return null;
  const tail = rest.trim();
  if (tail && (/[<"'\\;{}()]/.test(tail) || FORBIDDEN_VALUE_RE.test(tail))) return null;
  return `url("${url}")${tail ? ` ${tail}` : ""}`;
}

/** Limpia una hoja de estilos entera. */
export function sanitizeCss(css: string, options: CssCleanOptions): CssCleanResult {
  const ctx: Ctx = { ref: options.assetRef, scopeRoot: options.scopeRoot !== false, removed: 0, inFontFace: false, rawSelectors: false };
  const items = cleanItems(parseCss(css), ctx);
  return { css: serializeCss(items), removed: ctx.removed };
}

/** Limpia el atributo `style` de un elemento (una lista de declaraciones). Devuelve `""` si no queda nada. */
export function sanitizeStyleAttribute(style: string, options: Pick<CssCleanOptions, "assetRef">): { style: string; removed: number } {
  const ctx: Ctx = { ref: options.assetRef, scopeRoot: false, removed: 0, inFontFace: false, rawSelectors: true };
  const parsed = parseItems(`${style};`, 0, 0).items.filter((i): i is CssDecl => i.kind === "decl");
  const cleaned = parsed.map((d) => cleanDecl(d, ctx)).filter((d): d is CssDecl => d !== null);
  return { style: cleaned.map((d) => `${d.prop}:${d.value}${d.important ? " !important" : ""}`).join(";"), removed: ctx.removed };
}
