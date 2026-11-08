/**
 * De un archivo subido a un diseño cargado, sin tocar la red ni la base (F39–F42).
 *
 *   1. Se juntan los estilos (`<style>` y las hojas del zip) y se sacan del HTML.
 *   2. Se limpia el CSS (`css.ts`) y el HTML (`sanitize.ts`). Cada imagen o fuente del zip que se usa se
 *      valida por sus bytes y queda en un PLAN de archivos a subir; en el HTML y el CSS pasa a `asset:<ruta>`.
 *   3. Se detecta el formato (`detect.ts`) y se marcan los textos editables (`mark-text.ts`).
 *
 * Quien llama (la Server Action) sube el plan a `design-assets` y guarda el resultado.
 *
 * Módulo puro: recibe los archivos ya leídos y devuelve qué subir.
 */

import { checkImageUpload, importAssetPath } from "../storage";
import { checkFontUpload, type FontFileFormat } from "../fonts";
import { IMPORT_BASE_CSS, isGoogleFontsUrl, parseCss, sanitizeCss, serializeCss, type CssItem } from "./css";
import { detectFromParts } from "./detect";
import { tokenizeHtml } from "./html-scan";
import { markEditableText } from "./mark-text";
import { removedSummary, sanitizeImportedHtml, type RemovedCounts } from "./sanitize";
import type { UploadedSite } from "./zip";
import type { ImportRecord } from "./record";

/** Una imagen en línea (`data:`) de menos que esto se queda donde está; más grande pasa a ser un archivo. */
const INLINE_DATA_MAX_CHARS = 20_000;
/** Tope de la hoja de estilos que se guarda (el esquema del documento admite 500.000). */
const MAX_CSS_CHARS = 480_000;

export interface PlannedAsset {
  /** Ruta dentro de `design-assets` (`<ws>/imports/<uploadId>/<archivo>`). */
  path: string;
  kind: "image" | "font";
  mime: string;
  bytes: Uint8Array;
}

const FONT_MIME: Record<FontFileFormat, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Une una ruta relativa a una carpeta del zip. `null` si se sale de la raíz. */
export function resolveZipPath(baseDir: string, url: string): string | null {
  let clean = url.split(/[?#]/)[0].trim();
  if (clean === "") return null;
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // se usa como vino
  }
  if (clean.includes("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(clean)) return null;
  const parts = clean.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

export interface AssetResolver {
  /** Qué hacer con una dirección que aparece en el HTML o el CSS (relativa a `baseDir`). */
  ref: (url: string, baseDir: string) => string | null;
  plan: () => PlannedAsset[];
  /** Cuántos archivos usados no se pudieron guardar (faltan en el zip o no son imagen ni fuente admitida). */
  skipped: () => number;
}

export function createAssetResolver(input: { workspaceId: string; uploadId: string; files: ReadonlyMap<string, Uint8Array> }): AssetResolver {
  const lower = new Map<string, string>();
  for (const key of input.files.keys()) lower.set(key.toLowerCase(), key);
  const byZipPath = new Map<string, string | null>();
  const planned: PlannedAsset[] = [];
  const usedPaths = new Set<string>();
  const skippedPaths = new Set<string>();
  let inlineCount = 0;

  const plan = (flatName: string, kind: "image" | "font", mime: string, bytes: Uint8Array): string => {
    let path = importAssetPath(input.workspaceId, input.uploadId, flatName);
    for (let n = 2; usedPaths.has(path); n++) {
      const dot = flatName.lastIndexOf(".");
      const next = dot > 0 ? `${flatName.slice(0, dot)}-${n}${flatName.slice(dot)}` : `${flatName}-${n}`;
      path = importAssetPath(input.workspaceId, input.uploadId, next);
    }
    usedPaths.add(path);
    planned.push({ path, kind, mime, bytes });
    return `asset:${path}`;
  };

  return {
    ref(url, baseDir) {
      const raw = url.trim();
      if (/^data:image\//i.test(raw)) {
        if (raw.length < INLINE_DATA_MAX_CHARS) return raw;
        const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(raw);
        if (!m) return null;
        const bytes = new Uint8Array(Buffer.from(m[1], "base64"));
        const check = checkImageUpload(bytes);
        if (!check.ok) return null;
        inlineCount++;
        return plan(`imagen-${inlineCount}.${check.ext}`, "image", check.mime, bytes);
      }
      const zipPath = resolveZipPath(baseDir, raw);
      if (zipPath === null) return null;
      const key = input.files.has(zipPath) ? zipPath : lower.get(zipPath.toLowerCase());
      if (key === undefined) {
        skippedPaths.add(zipPath);
        return null;
      }
      if (byZipPath.has(key)) return byZipPath.get(key) ?? null;
      const bytes = input.files.get(key) as Uint8Array;
      let result: string | null = null;
      const image = checkImageUpload(bytes);
      if (image.ok) result = plan(key.replace(/\//g, "__"), "image", image.mime, bytes);
      else {
        const font = checkFontUpload(bytes);
        if (font.ok) result = plan(key.replace(/\//g, "__"), "font", FONT_MIME[font.format], bytes);
        else skippedPaths.add(key);
      }
      byZipPath.set(key, result);
      return result;
    },
    plan: () => planned,
    skipped: () => skippedPaths.size,
  };
}

// ─── Estilos ────────────────────────────────────────────────────────────────

export interface StyleBlock {
  css: string;
  /** Carpeta del archivo del que salió (para las `url()` relativas). */
  baseDir: string;
}

export interface ExtractedStyles {
  html: string;
  blocks: StyleBlock[];
  /** Hojas de Google Fonts enlazadas con `<link>`. */
  googleLinks: string[];
  /** `<link rel=stylesheet>` que no se pudieron incluir (otro dominio o no está en el zip). */
  droppedLinks: number;
}

const MEDIA_RE = /^[\w\s,():.-]{1,120}$/;

function wrapMedia(css: string, media: string | undefined): string {
  const m = (media ?? "").trim();
  if (m === "" || /^(all|screen)$/i.test(m)) return css;
  return MEDIA_RE.test(m) ? `@media ${m}{${css}}` : "";
}

/** Saca del HTML los `<style>` y los `<link rel=stylesheet>` y los junta. */
export function extractStyles(html: string, files: ReadonlyMap<string, Uint8Array>, mainDir: string): ExtractedStyles {
  const tokens = tokenizeHtml(html);
  const blocks: StyleBlock[] = [];
  const googleLinks: string[] = [];
  let droppedLinks = 0;
  const lower = new Map<string, string>();
  for (const key of files.keys()) lower.set(key.toLowerCase(), key);
  const decoder = new TextDecoder("utf-8");

  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "open" && t.name === "style") {
      const media = t.attrs.find((a) => a.name === "media")?.value;
      const next = tokens[i + 1];
      let skipTo = i;
      let css = "";
      if (next && next.kind === "text") {
        css = next.raw;
        skipTo = i + 1;
      }
      const after = tokens[skipTo + 1];
      if (after && after.kind === "close" && after.name === "style") skipTo = skipTo + 1;
      const wrapped = wrapMedia(css, media);
      if (wrapped) blocks.push({ css: wrapped, baseDir: mainDir });
      i = skipTo;
      continue;
    }
    if (t.kind === "open" && t.name === "link") {
      const rel = (t.attrs.find((a) => a.name === "rel")?.value ?? "").toLowerCase();
      const href = (t.attrs.find((a) => a.name === "href")?.value ?? "").trim();
      if (/\bstylesheet\b/.test(rel)) {
        if (isGoogleFontsUrl(href)) googleLinks.push(href);
        else {
          const zipPath = href && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) ? resolveZipPath(mainDir, href) : null;
          const key = zipPath ? (files.has(zipPath) ? zipPath : lower.get(zipPath.toLowerCase())) : undefined;
          const data = key ? files.get(key) : undefined;
          if (key && data && data.length <= 2 * 1024 * 1024) {
            const css = wrapMedia(decoder.decode(data), t.attrs.find((a) => a.name === "media")?.value);
            if (css) blocks.push({ css, baseDir: dirOf(key) });
          } else droppedLinks++;
        }
      }
      continue;
    }
    out += t.raw;
  }
  return { html: out, blocks, googleLinks, droppedLinks };
}

/** Junta las hojas ya limpias: los `@import` primero (sin ellos al principio el navegador los ignora) y, después, la base de lo cargado. */
export function joinCss(parts: readonly string[], googleLinks: readonly string[]): string {
  const imports: string[] = [];
  const rest: string[] = [];
  for (const href of googleLinks) if (isGoogleFontsUrl(href)) imports.push(`@import url("${href}");`);
  for (const part of parts) {
    const items = parseCss(part);
    const pick: CssItem[] = [];
    for (const item of items) {
      if (item.kind === "at" && item.name === "import") imports.push(serializeCss([item]));
      else pick.push(item);
    }
    if (pick.length > 0) rest.push(serializeCss(pick));
  }
  return [...new Set(imports), IMPORT_BASE_CSS, ...rest].join("\n");
}

// ─── Todo junto ─────────────────────────────────────────────────────────────

export type BuildImportResult = { ok: true; record: ImportRecord; plan: PlannedAsset[] } | { ok: false; error: string };

const visibleText = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").trim();

export function buildImportRecord(input: { site: UploadedSite; fileName: string; workspaceId: string; uploadId: string }): BuildImportResult {
  const { site } = input;
  const mainDir = dirOf(site.mainPath);
  const resolver = createAssetResolver({ workspaceId: input.workspaceId, uploadId: input.uploadId, files: site.files });

  const styles = extractStyles(site.html, site.files, mainDir);
  const removed: RemovedCounts = { scripts: 0, iframes: 0, forms: 0, other: styles.droppedLinks, videos: 0 };

  const cleanBlocks: string[] = [];
  for (const block of styles.blocks) {
    const cleaned = sanitizeCss(block.css, { assetRef: (u) => resolver.ref(u, block.baseDir), scopeRoot: true });
    removed.other += cleaned.removed;
    if (cleaned.css) cleanBlocks.push(cleaned.css);
  }
  const css = joinCss(cleanBlocks, styles.googleLinks);

  const cleaned = sanitizeImportedHtml(styles.html, { assetRef: (u) => resolver.ref(u, mainDir) });
  removed.scripts += cleaned.removed.scripts;
  removed.iframes += cleaned.removed.iframes;
  removed.forms += cleaned.removed.forms;
  removed.other += cleaned.removed.other;
  removed.videos += cleaned.removed.videos;

  if (visibleText(cleaned.html) === "" && !/<(?:img|svg|picture)\b/i.test(cleaned.html)) {
    return { ok: false, error: "El archivo no tiene contenido para mostrar. Si es una app (React, Vue…), exportala como página estática." };
  }
  if (css.length > MAX_CSS_CHARS) return { ok: false, error: "El CSS del archivo es demasiado grande (más de 480.000 caracteres)." };

  const detected = detectFromParts({ html: cleaned.html, css: cleanBlocks.join("\n") });
  const marked = markEditableText(cleaned.html);
  const plan = resolver.plan();
  const record: ImportRecord = {
    v: 1,
    fileName: input.fileName,
    html: marked.html,
    css,
    detected,
    removed: { scripts: removed.scripts, iframes: removed.iframes, forms: removed.forms, other: removed.other, summary: summaryWithSkipped(removed, resolver.skipped()) },
    assets: { images: plan.filter((p) => p.kind === "image").length, fonts: plan.filter((p) => p.kind === "font").length, skipped: resolver.skipped() },
  };
  return { ok: true, record, plan };
}

/** El aviso de lo que se quitó, más lo que no se pudo guardar (si hubo). */
export function summaryWithSkipped(removed: RemovedCounts, skipped: number): string | null {
  const base = removedSummary(removed);
  const extra = skipped > 0 ? (skipped === 1 ? "Un archivo (imagen o fuente) no se pudo guardar: falta o no es PNG, JPG ni WebP." : `${skipped} archivos (imágenes o fuentes) no se pudieron guardar: faltan o no son PNG, JPG ni WebP.`) : null;
  return [base, extra].filter(Boolean).join(" ") || null;
}
