/**
 * El render único del Diseñador IA (F10, §9.4).
 *
 * `renderPageHTML(doc, página, opciones)` devuelve un documento HTML+CSS
 * ESTÁTICO de una página. Lo usan el link público, el servicio de render (PNG y
 * PDF) y las miniaturas en vivo. El lienzo del editor (React) usa las MISMAS
 * funciones de estilo (`elementStyle`, `textInnerStyle`, `backgroundLayers`),
 * así lo que se ve es lo que se exporta.
 *
 * Lo que no se puede romper:
 * - Nunca produce `<script>`, atributos `on…=` ni `javascript:`. Los textos se
 *   escapan; el HTML de un elemento `html` ya viene limpio (DS4, `sanitize`) y
 *   acá pasa además por una limpieza defensiva (`stripActiveContent`).
 * - El orden de capas es el orden del arreglo: `z-index` = posición + 1. El
 *   fondo (color, degradé o imagen) va atrás y la capa de color encima de él.
 * - Un elemento oculto no sale en `public` ni en `export`.
 *
 * Módulo puro: corre en el servidor y en el navegador.
 */

import { clamp, rgba } from "../color";
import type { DesignDoc, DesignElement, DesignPage, HtmlElement, TextElement } from "../doc/schema";
import { googleCssUrl, uploadedFontFaces, type FontUse, type UploadedFont } from "../fonts";
import { FORMATS, WEB_BREAKPOINT_PX } from "../formats";

export type RenderMode = "edit" | "public" | "export";

export interface RenderOptions {
  mode: RenderMode;
  /** Valores de las variables. En `edit` sin valor, la variable se muestra como chip. */
  values?: Record<string, string>;
  /** Convierte la ruta de un archivo (`<ws>/…` o lo que sigue a `asset:`) en una URL (link firmado). */
  assetUrl: (path: string) => string;
  /** El nombre en español de una variable, para el chip (`edit`). */
  variableLabel?: (key: string) => string;
  /** Fuentes subidas por el negocio (las demás se piden a Google). */
  uploadedFonts?: readonly UploadedFont[];
  /** En `edit`, dibujar los ocultos semitransparentes en vez de no dibujarlos. */
  showHidden?: boolean;
}

/** Declaraciones CSS con nombres en kebab-case, en un orden fijo. */
export type CssDecl = Record<string, string>;

// ─── Escapes y limpieza defensiva ────────────────────────────────────────────

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Escapa un valor para ponerlo entre comillas dobles en CSS (`url("…")`, `font-family:"…"`). */
function cssString(value: string): string {
  return value.replace(/[\\"\n\r<>]/g, "");
}

/** Decodifica las entidades que se usan para disfrazar un esquema (`jav&#x61;script:`, `&colon;`) y saca los blancos. */
function normalizeUrlValue(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16) || 32))
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCodePoint(Number(dec) || 32))
    .replace(/&colon;?/gi, ":")
    .replace(/&(tab|newline|nbsp);?/gi, "")
    .replace(/[\u0000-\u0020\u007f-\u009f]+/g, "")
    .toLowerCase();
}

/** Los únicos destinos que se dejan en un atributo de URL: web, anclas, rutas, archivos propios e imágenes en línea. */
function isSafeUrl(value: string): boolean {
  const v = normalizeUrlValue(value);
  if (v === "" || v.startsWith("#") || v.startsWith("/") || v.startsWith("./") || v.startsWith("../") || v.startsWith("?")) return true;
  if (/^(https?:|mailto:|tel:|asset:)/.test(v)) return true;
  if (/^data:image\/(png|jpe?g|gif|webp);/.test(v)) return true;
  // Sin esquema (una ruta relativa): solo si no hay "algo:" al principio.
  return !/^([a-z][a-z0-9+.-]*):/.test(v);
}

/** Limpia los atributos de UNA etiqueta de apertura: manejadores, `srcdoc`, URLs inseguras y CSS peligroso en `style`. */
function cleanTag(tag: string): string {
  let out = tag;
  let prev: string;
  do {
    prev = out;
    out = out
      // Un manejador de eventos, también pegado al nombre de la etiqueta con "/" (`<img/onerror=…>`) o a una comilla.
      .replace(/([\s/"'])on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (_m, pre: string) => (pre.trim() === "" ? "" : pre))
      .replace(/\ssrcdoc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      // Atributos de URL: solo destinos seguros, aunque el esquema venga disfrazado con entidades.
      .replace(/\b(href|src|xlink:href|action|formaction|poster|background|data|to|values|from|by)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+))/gi, (attr, _n, _q, d, s1, bare) =>
        isSafeUrl((d ?? s1 ?? bare ?? "") as string) ? attr : "",
      )
      .replace(/\bstyle\s*=\s*("[^"]*"|'[^']*')/gi, (attr) =>
        attr.replace(/expression\s*\(/gi, "(").replace(/behavior\s*:/gi, "").replace(/-moz-binding\s*:/gi, "").replace(/javascript\s*:/gi, "").replace(/vbscript\s*:/gi, ""),
      );
  } while (out !== prev);
  return out;
}

/**
 * Limpieza defensiva del HTML de un elemento `html`. La limpieza de verdad es
 * la de DS4 al guardar (`lib/designer/import/sanitize.ts`); esto garantiza que
 * el render NUNCA devuelva algo ejecutable aunque llegara un documento viejo o
 * mal guardado. Los atributos se limpian SOLO dentro de las etiquetas: el texto
 * que ve la persona no se toca.
 */
export function stripActiveContent(html: string): string {
  let out = html;
  let prev: string;
  do {
    prev = out;
    out = out
      .replace(/<\s*(script|iframe|object|embed|frame|frameset|applet|base|meta|link|form)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/<\s*\/?\s*(script|iframe|object|embed|frame|frameset|applet|base|meta|link|form)\b[^>]*>/gi, "")
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_m, css: string) => `<style>${stripActiveCss(css)}</style>`)
      .replace(/<[a-zA-Z][^<>]*>/g, (tag) => cleanTag(tag));
  } while (out !== prev);
  return out;
}

/** Limpieza defensiva de CSS: sin cerrar el `<style>`, sin `expression()`, sin `javascript:`, sin `@import` fuera de Google Fonts. */
export function stripActiveCss(css: string): string {
  return css
    .replace(/</g, "")
    .replace(/-->/g, "")
    .replace(/expression\s*\(/gi, "(")
    .replace(/javascript\s*:/gi, "")
    .replace(/behavior\s*:/gi, "")
    .replace(/-moz-binding\s*:/gi, "")
    .replace(/@import\s+(?!(?:url\()?\s*["']?https:\/\/fonts\.googleapis\.com\/)[^;]*;?/gi, "");
}

/** Cambia cada `asset:<ruta>` por la URL que da `assetUrl`. */
export function rewriteAssetRefs(text: string, assetUrl: (path: string) => string): string {
  return text.replace(/asset:([A-Za-z0-9._\-/]+)/g, (_m, path: string) => cssString(assetUrl(path)));
}

// ─── Estilos (los mismos para el lienzo y para el render) ───────────────────

function round(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** El estilo de la caja de un elemento: posición en %, tamaño, rotación, opacidad y orden. */
export function elementStyle(el: DesignElement, zIndex = 1): CssDecl {
  const decl: CssDecl = {
    position: "absolute",
    left: `${round(el.x)}%`,
    top: `${round(el.y)}%`,
    width: `${round(el.w)}%`,
  };
  if (el.h !== undefined && el.type !== "text") decl.height = `${round(el.h)}%`;
  decl.transform = `translate(-50%, -50%)${el.rotation ? ` rotate(${round(el.rotation)}deg)` : ""}`;
  if (el.opacity !== undefined && el.opacity < 1) decl.opacity = round(clamp(el.opacity, 0, 1));
  decl["z-index"] = String(zIndex);

  if (el.type === "text") {
    decl["font-family"] = `"${cssString(el.font.family)}", sans-serif`;
    decl["font-weight"] = String(el.font.weight);
    if (el.font.italic) decl["font-style"] = "italic";
    decl["font-size"] = `${round(el.size)}px`;
    decl["line-height"] = round(el.lineHeight ?? 1.2);
    if (el.letterSpacing) decl["letter-spacing"] = `${round(el.letterSpacing)}px`;
    decl["text-align"] = el.align;
    decl.color = el.color;
    if (el.transform === "uppercase") decl["text-transform"] = "uppercase";
    if (el.shadow) decl["text-shadow"] = "0 2px 12px rgba(0, 0, 0, 0.45)";
    decl["white-space"] = "pre-wrap";
    decl["overflow-wrap"] = "break-word";
  }
  if (el.type === "image") {
    decl.overflow = "hidden";
    if (el.radius) decl["border-radius"] = `${round(el.radius)}px`;
  }
  if (el.type === "shape") {
    if (el.shape === "line") {
      decl.height = `${round(Math.max(el.stroke?.width ?? 2, 1))}px`;
      decl.background = el.stroke?.color ?? el.fill ?? "#000000";
    } else {
      if (el.fill) decl.background = el.fill;
      if (el.stroke && el.stroke.width > 0) decl.border = `${round(el.stroke.width)}px solid ${el.stroke.color}`;
      decl["border-radius"] = el.shape === "circle" ? "50%" : `${round(el.radius ?? 0)}px`;
    }
  }
  if (el.type === "html") decl.overflow = "hidden";
  return decl;
}

/** El estilo del texto por dentro (el resaltado de fondo va en el `<span>` para que siga cada renglón). */
export function textInnerStyle(el: TextElement): CssDecl {
  if (!el.highlight || el.highlight.opacity <= 0) return {};
  return {
    "background-color": rgba(el.highlight.color, el.highlight.opacity),
    "box-decoration-break": "clone",
    "-webkit-box-decoration-break": "clone",
    padding: "0 0.15em",
  };
}

export interface BackgroundLayer {
  kind: "base" | "image" | "overlay";
  style: CssDecl;
}

/**
 * Las capas del fondo, de atrás hacia adelante: el color o degradé, la imagen y
 * la capa de color encima. La opacidad de la capa se corrige a 0–90 %.
 */
export function backgroundLayers(page: DesignPage): BackgroundLayer[] {
  const bg = page.background;
  const layers: BackgroundLayer[] = [];
  const base: CssDecl = { position: "absolute", inset: "0", "z-index": "0" };
  if (bg.type === "gradient" && bg.gradient) base.background = `linear-gradient(${round(bg.gradient.angle)}deg, ${bg.gradient.from}, ${bg.gradient.to})`;
  else base.background = bg.color ?? (bg.type === "image" ? "#000000" : "#ffffff");
  layers.push({ kind: "base", style: base });
  if (bg.type === "image" && bg.image) {
    layers.push({
      kind: "image",
      style: {
        position: "absolute",
        inset: "0",
        "z-index": "0",
        "background-image": `url("asset:${cssString(bg.image.asset)}")`,
        "background-size": bg.image.fit,
        "background-position": `${round(bg.image.focal.x)}% ${round(bg.image.focal.y)}%`,
        "background-repeat": "no-repeat",
      },
    });
  }
  if (bg.overlay) {
    const opacity = clamp(bg.overlay.opacity, 0, 0.9);
    if (opacity > 0) layers.push({ kind: "overlay", style: { position: "absolute", inset: "0", "z-index": "0", background: rgba(bg.overlay.color, opacity) } });
  }
  return layers;
}

/** Declaraciones CSS → texto `prop: valor; …`. */
export function cssText(decl: CssDecl): string {
  return Object.entries(decl)
    .map(([prop, value]) => `${prop}: ${value}`)
    .join("; ");
}

/** Declaraciones CSS → objeto de estilo de React (camelCase; los prefijos `-webkit-` pasan a `Webkit…`). */
export function toReactStyle(decl: CssDecl): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [prop, value] of Object.entries(decl)) {
    const key = prop.replace(/^-webkit-/, "Webkit-").replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[key.replace(/^Webkit([A-Z])/, (_m, c: string) => `Webkit${c}`)] = value;
  }
  return out;
}

// ─── Textos con variables ────────────────────────────────────────────────────

/** El texto de un elemento en HTML: escapado, con las variables reemplazadas (o como chips en `edit`). */
export function renderText(text: string, opts: Pick<RenderOptions, "mode" | "values" | "variableLabel">): string {
  const parts: string[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\}\}/g)) {
    parts.push(escapeHtml(text.slice(last, match.index)));
    const key = match[1];
    const value = opts.values?.[key];
    if (value !== undefined) parts.push(escapeHtml(value));
    else if (opts.mode === "edit") parts.push(`<span class="dz-var" data-var="${escapeHtml(key)}">${escapeHtml(opts.variableLabel?.(key) ?? key)}</span>`);
    last = (match.index ?? 0) + match[0].length;
  }
  parts.push(escapeHtml(text.slice(last)));
  return parts.join("");
}

/** Reemplaza las variables dentro de los nodos de texto de un HTML ya limpio (los `data-tx` de lo cargado). */
function renderHtmlVariables(html: string, opts: RenderOptions): string {
  return html.replace(/\{\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\}\}/g, (_m, key: string) => {
    const value = opts.values?.[key];
    if (value !== undefined) return escapeHtml(value);
    if (opts.mode === "edit") return `<span class="dz-var" data-var="${escapeHtml(key)}">${escapeHtml(opts.variableLabel?.(key) ?? key)}</span>`;
    return "";
  });
}

// ─── El documento ────────────────────────────────────────────────────────────

/** Las fuentes que usa una página (familia y pesos), para pedirlas a Google o cargarlas. */
export function fontsUsed(page: DesignPage): FontUse[] {
  const map = new Map<string, Set<number>>();
  for (const el of page.elements) {
    if (el.type !== "text") continue;
    const set = map.get(el.font.family) ?? new Set<number>();
    set.add(el.font.weight);
    map.set(el.font.family, set);
  }
  return [...map].map(([family, weights]) => ({ family, weights: [...weights] }));
}

function isFullPageHtml(el: HtmlElement): boolean {
  return el.w >= 99.9 && (el.h ?? 0) >= 99.9 && Math.abs(el.x - 50) < 0.1 && Math.abs(el.y - 50) < 0.1;
}

function renderElement(el: DesignElement, zIndex: number, opts: RenderOptions, web: boolean): string {
  const style = elementStyle(el, zIndex);
  const hiddenInEdit = el.hidden && opts.mode === "edit";
  if (hiddenInEdit) style.opacity = "0.25";
  const attrs = `data-el="${escapeHtml(el.id)}" data-el-type="${el.type}"`;
  switch (el.type) {
    case "text": {
      const inner = cssText(textInnerStyle(el));
      const body = renderText(el.text, opts);
      return `<div ${attrs} style="${escapeHtml(cssText(style))}">${inner ? `<span style="${escapeHtml(inner)}">${body}</span>` : body}</div>`;
    }
    case "image": {
      const src = escapeHtml(opts.assetUrl(el.asset));
      return `<div ${attrs} style="${escapeHtml(cssText(style))}"><img src="${src}" alt="" style="width: 100%; height: 100%; object-fit: ${el.fit}; display: block"></div>`;
    }
    case "shape":
      return `<div ${attrs} style="${escapeHtml(cssText(style))}"></div>`;
    case "html": {
      const html = renderHtmlVariables(rewriteAssetRefs(stripActiveContent(el.html), opts.assetUrl), opts);
      const cls = web && isFullPageHtml(el) ? ' class="dz-flow"' : "";
      return `<div ${attrs}${cls} style="${escapeHtml(cssText(style))}">${html}</div>`;
    }
  }
}

/**
 * La página `pageIndex` del documento como HTML estático. `public` y `export`
 * reemplazan las variables por sus valores (una variable sin valor queda vacía);
 * `edit` sin valor la muestra como chip.
 */
export function renderPageHTML(doc: DesignDoc, pageIndex: number, opts: RenderOptions): string {
  const page = doc.pages[pageIndex];
  if (!page) throw new Error(`El diseño no tiene la página ${pageIndex + 1}`);
  const format = FORMATS[doc.format];
  const web = doc.format === "web";
  const width = format.width;
  const height = web ? (page.height ?? format.height) : format.height;

  const visible = page.elements.filter((el) => !el.hidden || (opts.mode === "edit" && opts.showHidden));
  const elements = visible.map((el) => renderElement(el, page.elements.indexOf(el) + 1, opts, web)).join("");
  const layers = backgroundLayers(page)
    .map((layer) => {
      const css = cssText(layer.style).replace(/asset:([^")]+)/g, (_m, path: string) => cssString(opts.assetUrl(path)));
      return `<div class="dz-bg dz-bg-${layer.kind}" style="${escapeHtml(css)}"></div>`;
    })
    .join("");

  const google = googleCssUrl(fontsUsed(page).filter((f) => !(opts.uploadedFonts ?? []).some((u) => u.family === f.family)));
  const faces = uploadedFontFaces(opts.uploadedFonts ?? [], opts.assetUrl);
  const htmlCss = page.elements
    .filter((el): el is HtmlElement => el.type === "html" && !!el.css)
    .map((el) => rewriteAssetRefs(stripActiveCss(el.css as string), opts.assetUrl))
    .join("\n");

  const pageBox = web && opts.mode === "public" ? `width: 100%; max-width: ${width}px; min-height: ${height}px; margin: 0 auto` : `width: ${width}px; height: ${height}px`;
  const responsive = web
    ? `@media (max-width: ${WEB_BREAKPOINT_PX}px){.dz-page{width:100%!important;height:auto!important;min-height:0!important}` +
      `[data-el]{position:relative!important;left:auto!important;top:auto!important;transform:none!important;width:auto!important;height:auto!important;margin:16px}` +
      `.dz-flow{margin:0!important;width:100%!important}}`
    : "";
  const chips =
    opts.mode === "edit"
      ? `.dz-var{display:inline-block;padding:0 .35em;border-radius:.4em;background:rgba(124,58,237,.16);color:#6d28d9;font-weight:600;white-space:nowrap}`
      : "";
  const styles = [
    `*{box-sizing:border-box;margin:0;padding:0}`,
    `html,body{background:transparent}`,
    web ? `body{overflow-x:hidden}` : `html,body{width:${width}px;height:${height}px;overflow:hidden}`,
    `.dz-page{position:relative;overflow:hidden;${pageBox}}`,
    `.dz-flow{position:relative!important;left:auto!important;top:auto!important;transform:none!important;width:100%!important;height:auto!important}`,
    `img{max-width:100%}`,
    faces,
    chips,
    responsive,
    htmlCss,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `<!doctype html><html lang="es"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    google ? `<link rel="stylesheet" href="${escapeHtml(google)}">` : "",
    `<style>${styles}</style></head>`,
    `<body><div class="dz-page" data-format="${doc.format}" data-page="${escapeHtml(page.id)}">${layers}${elements}</div></body></html>`,
  ].join("");
}
