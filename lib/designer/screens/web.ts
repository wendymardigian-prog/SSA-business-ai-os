/**
 * La página web (formato `web`, F29): una sola página de alto libre, de 1280 px de ancho de diseño y RESPONSIVE al
 * publicarse (un punto de quiebre a 640 px: las columnas pasan a una).
 *
 * - El lienzo muestra el ancho completo con desplazamiento vertical y un conmutador **Escritorio / Celular**: Escritorio
 *   es la edición de siempre; Celular es una vista previa del render PÚBLICO a 390 px (el mismo `renderPageHTML`).
 * - `declaredMinWidths` calcula el ancho mínimo que declara el HTML (anchos y anchos mínimos en px, con la cascada de
 *   las reglas de `<style>`, las de `@media` que aplican a ese ancho y los `style=""` en línea) y `overflowReport` dice
 *   si algo se pasa del ancho de la pantalla. Es lo que prueba que el render público a 390 px no tiene desplazamiento
 *   horizontal: no mide un navegador, lee lo que el documento DECLARA.
 *
 * Módulo puro.
 */

import type { DesignDoc } from "../doc/schema";
import { FORMATS, WEB_BREAKPOINT_PX } from "../formats";
import { renderPageHTML } from "../render/page-html";

export type Device = "desktop" | "mobile";

export const DEVICES: Record<Device, { label: string; width: number }> = {
  desktop: { label: "Escritorio", width: FORMATS.web.width },
  mobile: { label: "Celular", width: 390 },
};

/** El HTML de la vista previa del celular: el render PÚBLICO de la página (con su punto de quiebre). */
export function mobilePreviewHtml(doc: DesignDoc, assetUrl: (path: string) => string, values?: Record<string, string>): string {
  return renderPageHTML(doc, 0, { mode: "public", assetUrl, values });
}

export { WEB_BREAKPOINT_PX };

// ─── Anchos mínimos declarados ───────────────────────────────────────────────

interface Decl {
  value: string;
  important: boolean;
}

interface Rule {
  selectors: string[];
  decls: Record<string, Decl>;
}

interface Tag {
  name: string;
  classes: string[];
  attrs: Record<string, string>;
  style: Record<string, Decl>;
}

function parseDeclarations(body: string): Record<string, Decl> {
  const out: Record<string, Decl> = {};
  for (const part of body.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const prop = part.slice(0, at).trim().toLowerCase();
    let value = part.slice(at + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    value = value.replace(/!\s*important\s*$/i, "").trim();
    if (prop) out[prop] = { value, important };
  }
  return out;
}

/** Las reglas de un CSS que valen para `viewport`: las sueltas y las de `@media` con `max-width` / `min-width` que se cumplen. */
function applicableRules(css: string, viewport: number): Rule[] {
  const rules: Rule[] = [];
  const scan = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      i = j;
      if (head.startsWith("@media")) {
        const max = /max-width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(head);
        const min = /min-width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(head);
        const onlyWidth = /^@media\s*(?:screen\s*and\s*)?(?:\(\s*(?:max|min)-width\s*:\s*[\d.]+px\s*\)\s*(?:and\s*)?)+$/i.test(head);
        if (!onlyWidth) continue; // print, orientation…: no se evalúa
        if (max && viewport > Number(max[1])) continue;
        if (min && viewport < Number(min[1])) continue;
        scan(body);
      } else if (head.startsWith("@")) {
        continue; // @font-face, @keyframes…
      } else {
        rules.push({ selectors: head.split(",").map((s) => s.trim()).filter(Boolean), decls: parseDeclarations(body) });
      }
    }
  };
  scan(css);
  return rules;
}

/** Los tags de apertura de un HTML con sus clases, atributos y estilo en línea (suficiente para los selectores simples). */
function readTags(html: string): Tag[] {
  const tags: Tag[] = [];
  for (const match of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>"'=\s]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of match[2].matchAll(/([^<>"'=\s]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
    tags.push({ name: match[1].toLowerCase(), classes: (attrs.class ?? "").split(/\s+/).filter(Boolean), attrs, style: parseDeclarations(attrs.style ?? "") });
  }
  return tags;
}

/** Si un selector SIMPLE (etiqueta, `.clase`, `[atributo]`, `[atributo=valor]`, `*` y sus combinaciones) aplica al tag. Los combinadores no se evalúan. */
function matches(selector: string, tag: Tag): boolean {
  if (/[\s>+~]/.test(selector.replace(/\[[^\]]*\]/g, ""))) return false;
  if (selector.includes(":")) return false;
  const parts = selector.match(/(\*|^[a-zA-Z][a-zA-Z0-9-]*|\.[\w-]+|\[[^\]]+\])/g);
  if (!parts || parts.join("") !== selector) return false;
  return parts.every((part) => {
    if (part === "*") return true;
    if (part.startsWith(".")) return tag.classes.includes(part.slice(1));
    if (part.startsWith("[")) {
      const m = /^\[\s*([\w-]+)\s*(?:=\s*"?([^"\]]*)"?)?\s*\]$/.exec(part);
      if (!m) return false;
      return m[2] === undefined ? m[1].toLowerCase() in tag.attrs : tag.attrs[m[1].toLowerCase()] === m[2];
    }
    return tag.name === part.toLowerCase();
  });
}

const PX = /^(\d+(?:\.\d+)?)px$/i;

/** El valor final de una propiedad: lo importante primero, después el estilo en línea y por último las reglas, en orden. */
function cascade(prop: string, tag: Tag, rules: readonly Rule[]): string | null {
  let value: Decl | null = null;
  for (const rule of rules) {
    const decl = rule.decls[prop];
    if (!decl || !rule.selectors.some((s) => matches(s, tag))) continue;
    if (!value || decl.important || !value.important) value = decl;
  }
  const inline = tag.style[prop];
  if (inline && (!value || inline.important || !value.important)) value = inline;
  return value?.value ?? null;
}

export interface OverflowOffender {
  tag: string;
  property: "width" | "min-width";
  width: number;
}

export interface OverflowReport {
  viewport: number;
  /** El ancho en px más grande que declara algo (0 si nada declara un ancho fijo). */
  widest: number;
  offenders: OverflowOffender[];
  overflows: boolean;
}

/**
 * Los anchos mínimos que declara un HTML para un ancho de pantalla: `width` y `min-width` en px, después de la
 * cascada (reglas de `<style>`, `@media` que aplican, estilo en línea e `!important`). Lo que está en %, `auto`, `vw`,
 * `calc()` o `max-width` no cuenta: se adapta. Las etiquetas `html`, `body` y `head` no cuentan.
 */
export function overflowReport(html: string, viewport: number): OverflowReport {
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]).join("\n");
  const rules = applicableRules(css, viewport);
  const offenders: OverflowOffender[] = [];
  const body = html.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "").replace(/<head\b[\s\S]*?<\/head\s*>/gi, "");
  for (const tag of readTags(body)) {
    if (tag.name === "html" || tag.name === "body") continue;
    for (const property of ["width", "min-width"] as const) {
      const value = cascade(property, tag, rules);
      const px = value ? PX.exec(value) : null;
      if (px && Number(px[1]) > 0) offenders.push({ tag: tag.name, property, width: Number(px[1]) });
    }
  }
  const widest = offenders.reduce((max, o) => Math.max(max, o.width), 0);
  return { viewport, widest, offenders: offenders.filter((o) => o.width > viewport), overflows: widest > viewport };
}

/** El ancho mínimo declarado por un HTML a ese ancho de pantalla (0 = nada fijo). */
export function declaredMinWidth(html: string, viewport: number): number {
  return overflowReport(html, viewport).widest;
}

/** Si el render público de la página a ese ancho se pasaría de la pantalla (hay un desplazamiento horizontal). */
export function hasHorizontalOverflow(doc: DesignDoc, viewport: number = DEVICES.mobile.width, assetUrl: (path: string) => string = () => ""): boolean {
  return overflowReport(mobilePreviewHtml(doc, assetUrl), viewport).overflows;
}
