/**
 * Detectar el formato de un archivo HTML cargado (F41).
 *
 * Es una PRESENTACIÓN si hay 2 o más hijos de primer nivel con clase `slide`, `page` o `section` y
 * tamaño fijo, o si el archivo declara `@page` o reglas de 16:9, 4:5, 9:16 o 1:1. Cada uno pasa a una
 * página con el tamaño que se detectó (16:9 → `wide`, 4:5 → `v45`, 9:16 → `story`, 1:1 → `sq`).
 * Si no, es una PÁGINA WEB (`web`): una sola página con scroll. Ante la duda, página web: es lo que no
 * rompe nada (la persona puede corregirlo en el modal).
 *
 * No usa el DOM del navegador (corre en el servidor): lee la estructura con `html-scan` y el CSS con `css`.
 *
 * Módulo puro.
 */

import { FORMATS, type FormatKey } from "../formats";
import { parseCss, type CssItem, type CssRule } from "./css";
import { buildTree, nodeAttr, nodeClasses, outerHtml, tokenizeHtml, type HtmlNode, type HtmlTree } from "./html-scan";

export type HtmlImportAs = "web" | "slides";

export interface HtmlDetection {
  as: HtmlImportAs;
  /** `web`, o el formato de las diapositivas. */
  format: FormatKey;
  pages: number;
  /** "Presentación · 5 diapositivas de 1920 × 1080" o "Página web · una sola página con scroll". */
  label: string;
  /** El tamaño que declara el archivo (puede no coincidir con el del formato). */
  sizePx: { w: number; h: number } | null;
  /** Por qué se decidió así (para los tests y los logs; no se muestra). */
  reason: string;
}

/** Los formatos a los que puede ir una presentación cargada. */
export const SLIDE_FORMATS = ["wide", "v45", "story", "sq"] as const satisfies readonly FormatKey[];
export type SlideFormat = (typeof SLIDE_FORMATS)[number];

const RATIOS: Record<SlideFormat, number> = { wide: 16 / 9, v45: 4 / 5, story: 9 / 16, sq: 1 };
const RATIO_TOLERANCE: Record<SlideFormat, number> = { wide: 0.04, v45: 0.03, story: 0.03, sq: 0.03 };

/** El formato de una proporción, si es una de las cuatro conocidas. */
export function formatForRatio(ratio: number): SlideFormat | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  for (const key of SLIDE_FORMATS) if (Math.abs(ratio - RATIOS[key]) <= RATIO_TOLERANCE[key]) return key;
  return null;
}

/** El formato más cercano a una proporción (para tamaños que no son ninguno de los cuatro). */
export function nearestSlideFormat(ratio: number): SlideFormat {
  if (!Number.isFinite(ratio) || ratio <= 0) return "wide";
  let best: SlideFormat = "wide";
  let bestDistance = Infinity;
  for (const key of SLIDE_FORMATS) {
    const distance = Math.abs(Math.log(ratio / RATIOS[key]));
    if (distance < bestDistance) {
      best = key;
      bestDistance = distance;
    }
  }
  return best;
}

const UNIT_PX: Record<string, number> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16 };

function toPx(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(-?\d*\.?\d+)(px|in|cm|mm|pt|pc)$/i.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1]) * UNIT_PX[m[2].toLowerCase()];
  return n > 0 ? n : null;
}

function parseRatio(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^\s*(\d*\.?\d+)\s*(?:\/\s*(\d*\.?\d+))?\s*$/.exec(value.replace(/!important/i, ""));
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = m[2] ? parseFloat(m[2]) : 1;
  return a > 0 && b > 0 ? a / b : null;
}

const PAPER: Record<string, [number, number]> = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
};

/** El tamaño de `@page { size: … }`: dos medidas, un papel con orientación o solo la orientación. */
function parsePageSize(value: string): { w: number; h: number } | { ratio: number } | null {
  const words = value.toLowerCase().replace(/!important/g, "").trim().split(/\s+/);
  const lengths = words.map(toPx);
  if (lengths.length === 2 && lengths[0] && lengths[1]) return { w: lengths[0], h: lengths[1] };
  if (lengths.length === 1 && lengths[0]) return { w: lengths[0], h: lengths[0] };
  const paper = words.find((w) => PAPER[w]);
  if (paper) {
    const [pw, ph] = PAPER[paper];
    const landscape = words.includes("landscape");
    const mmToPx = 96 / 25.4;
    return landscape ? { w: ph * mmToPx, h: pw * mmToPx } : { w: pw * mmToPx, h: ph * mmToPx };
  }
  return null;
}

// ─── El archivo ─────────────────────────────────────────────────────────────

const IGNORED = new Set(["script", "style", "link", "meta", "title", "noscript", "template", "base", "head"]);

/** Los elementos de primer nivel de la página (el `html` y el `body` no cuentan como niveles). */
function flowChildren(nodes: readonly HtmlNode[]): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (const node of nodes) {
    if (node.name === "html" || node.name === "body") out.push(...flowChildren(node.children));
    else if (!IGNORED.has(node.name)) out.push(node);
  }
  return out;
}

const SLIDE_WORDS = ["slide", "page", "section"];

function isSlideLike(node: HtmlNode): boolean {
  return nodeClasses(node).some((cls) => {
    const c = cls.toLowerCase();
    return SLIDE_WORDS.some((w) => c === w || c.startsWith(`${w}-`) || c.startsWith(`${w}_`) || new RegExp(`^${w}\\d+$`).test(c));
  });
}

interface Analysis {
  source: string;
  tree: HtmlTree;
  rules: CssRule[];
  pageRules: CssItem[];
  top: HtmlNode[];
  candidates: HtmlNode[];
}

function styleBlocks(tree: HtmlTree): string {
  const out: string[] = [];
  for (const node of tree.nodes) {
    if (node.name !== "style") continue;
    for (const index of node.textTokens) out.push(tree.tokens[index].raw);
  }
  return out.join("\n");
}

function collectRules(items: readonly CssItem[], rules: CssRule[], pageRules: CssItem[]): void {
  for (const item of items) {
    if (item.kind === "rule") rules.push(item);
    else if (item.kind === "at") {
      if (item.name === "page") pageRules.push(item);
      else if (item.items && (item.name === "media" || item.name === "supports" || item.name === "layer") && !/print|max-width|min-width|orientation/i.test(item.prelude)) {
        collectRules(item.items, rules, pageRules);
      }
    }
  }
}

function analyze(source: string, extraCss: string): Analysis {
  const tree = buildTree(tokenizeHtml(source));
  const css = [styleBlocks(tree), extraCss].filter(Boolean).join("\n");
  const rules: CssRule[] = [];
  const pageRules: CssItem[] = [];
  collectRules(parseCss(css), rules, pageRules);
  const top = flowChildren(tree.roots);

  // Hijos con clase de diapositiva: de primer nivel o, si hay un solo contenedor, de su interior.
  let level = top;
  let candidates = level.filter(isSlideLike);
  for (let depth = 0; candidates.length < 2 && depth < 3; depth++) {
    const meaningful = level.filter((n) => n.name !== "br");
    if (meaningful.length !== 1) break;
    level = flowChildren(meaningful[0].children);
    candidates = level.filter(isSlideLike);
  }
  return { source, tree, rules, pageRules, top: level.length > 0 ? level : top, candidates };
}

// ─── Estilos de un elemento ─────────────────────────────────────────────────

function declsOf(rule: CssRule): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of rule.items) if (item.kind === "decl") out[item.prop.toLowerCase()] = item.value;
  return out;
}

const COMPOUND_RE = /^(?:([a-z][a-z0-9-]*)|\*)?((?:[.#][\w-]+)*)$/i;

function matchesSelector(selector: string, node: HtmlNode): boolean {
  for (const part of selector.split(",")) {
    const last = part.trim().split(/\s*[>+~\s]\s*/).pop() ?? "";
    const compound = last.replace(/::?[\w-]+(\([^)]*\))?/g, "");
    const m = COMPOUND_RE.exec(compound);
    if (!m) continue;
    if (m[1] && m[1].toLowerCase() !== node.name) continue;
    if (!m[1] && compound === "") continue;
    const classes = nodeClasses(node);
    const id = nodeAttr(node, "id");
    const ok = (m[2].match(/[.#][\w-]+/g) ?? []).every((piece) => (piece[0] === "." ? classes.includes(piece.slice(1)) : id === piece.slice(1)));
    if (ok) return true;
  }
  return false;
}

function inlineDecls(node: HtmlNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (nodeAttr(node, "style") ?? "").split(";")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

interface Box {
  w: number | null;
  h: number | null;
  ratio: number | null;
}

function boxOf(node: HtmlNode, rules: readonly CssRule[]): Box {
  let width: string | undefined;
  let height: string | undefined;
  let aspect: string | undefined;
  for (const rule of rules) {
    if (!matchesSelector(rule.selector, node)) continue;
    const d = declsOf(rule);
    width = d.width ?? width;
    height = d.height ?? height;
    aspect = d["aspect-ratio"] ?? aspect;
  }
  const inline = inlineDecls(node);
  width = inline.width ?? width;
  height = inline.height ?? height;
  aspect = inline["aspect-ratio"] ?? aspect;
  return { w: toPx(width), h: toPx(height), ratio: parseRatio(aspect) };
}

// ─── Detección ──────────────────────────────────────────────────────────────

function slideLabel(pages: number, format: FormatKey): string {
  const f = FORMATS[format];
  return `Presentación · ${pages} ${pages === 1 ? "diapositiva" : "diapositivas"} de ${f.width} × ${f.height}`;
}

export const WEB_LABEL = "Página web · una sola página con scroll";

function webResult(reason: string): HtmlDetection {
  return { as: "web", format: "web", pages: 1, label: WEB_LABEL, sizePx: null, reason };
}

function decide(a: Analysis): HtmlDetection {
  const pages = a.candidates.length > 0 ? a.candidates : a.top;
  const boxes = a.candidates.map((n) => boxOf(n, a.rules));
  const fixed = boxes.filter((b) => b.w !== null && b.h !== null);

  // @page con una proporción conocida.
  let pageSize: { w: number; h: number } | { ratio: number } | null = null;
  for (const rule of a.pageRules) {
    if (rule.kind !== "at" || !rule.items) continue;
    const size = rule.items.find((i) => i.kind === "decl" && i.prop.toLowerCase() === "size");
    if (size && size.kind === "decl") pageSize = parsePageSize(size.value) ?? pageSize;
  }
  const pageRatio = pageSize ? ("ratio" in pageSize ? pageSize.ratio : pageSize.w / pageSize.h) : null;
  const pageFormat = pageRatio !== null ? formatForRatio(pageRatio) : null;

  // aspect-ratio de 16:9, 4:5, 9:16 o 1:1 en las diapositivas (o, sin ellas, en un elemento de primer nivel).
  const aspectBoxes = (a.candidates.length > 0 ? a.candidates : a.top).map((n) => boxOf(n, a.rules));
  const aspectFormat = aspectBoxes.map((b) => (b.ratio !== null ? formatForRatio(b.ratio) : null)).find((f) => f !== null) ?? null;

  const byFixedSize = a.candidates.length >= 2 && fixed.length >= 2;
  const byPage = pageFormat !== null && pages.length >= 1;
  const byAspect = aspectFormat !== null && (a.candidates.length >= 2 || (a.candidates.length === 0 && a.top.length >= 2));
  if (!byFixedSize && !byPage && !byAspect) return webResult("sin diapositivas de tamaño fijo, ni @page, ni proporciones conocidas");

  let sizePx: { w: number; h: number } | null = null;
  let format: SlideFormat;
  let reason: string;
  if (byFixedSize) {
    const first = fixed[0] as { w: number; h: number };
    sizePx = { w: Math.round(first.w), h: Math.round(first.h) };
    format = formatForRatio(first.w / first.h) ?? nearestSlideFormat(first.w / first.h);
    reason = "diapositivas de tamaño fijo";
  } else if (byPage && pageFormat) {
    if (pageSize && "w" in pageSize) sizePx = { w: Math.round(pageSize.w), h: Math.round(pageSize.h) };
    format = pageFormat;
    reason = "@page con una proporción conocida";
  } else {
    format = aspectFormat as SlideFormat;
    reason = "aspect-ratio conocido";
  }
  const count = Math.max(1, pages.length);
  return { as: "slides", format, pages: count, label: slideLabel(count, format), sizePx, reason };
}

/** Detecta el formato de un archivo HTML tal cual lo subió la persona. Nunca lanza. */
export function detectHtmlFormat(html: string): HtmlDetection {
  return decide(analyze(html, ""));
}

/** Lo mismo, sobre el contenido ya limpio y el CSS que se juntó aparte. */
export function detectFromParts(parts: { html: string; css: string }): HtmlDetection {
  return decide(analyze(parts.html, parts.css));
}

/** El HTML de cada diapositiva. Sin diapositivas con clase, cada elemento de primer nivel es una. */
export function splitSlides(parts: { html: string; css: string }): string[] {
  const a = analyze(parts.html, parts.css);
  const nodes = a.candidates.length > 0 ? a.candidates : a.top;
  return nodes.map((node) => outerHtml(a.tree, node, a.source));
}

/**
 * Un alto razonable para una página web cargada: no se puede medir sin dibujarla. En el editor la página
 * tiene un alto propio; en el link y en el PDF la página crece con su contenido.
 */
export function estimateWebHeight(parts: { html: string; css: string }): number {
  const a = analyze(parts.html, parts.css);
  const blocks = Math.max(1, a.top.length);
  return Math.min(20_000, Math.max(2_000, blocks * 700));
}

