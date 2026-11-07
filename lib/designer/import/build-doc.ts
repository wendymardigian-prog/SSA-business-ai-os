/**
 * Del archivo cargado al documento del diseño (F41, F42).
 *
 * Cada página cargada es UN elemento `html` que ocupa toda la página (`x: 50, y: 50, w: 100, h: 100`):
 *   - Página web: una sola página con todo el contenido (el formato queda en `web`).
 *   - Presentación: una página por diapositiva, en el formato detectado. Si el archivo declara otro
 *     tamaño que el del formato (1280 × 720 en un `wide` de 1920 × 1080), la diapositiva se escala.
 *
 * El contenido va dentro de una caja `.dz-import` (a ella pasaron `html`, `body` y `:root` del CSS).
 * Una plantilla no puede ser una página web (no se imprime ni se exporta).
 *
 * Módulo puro.
 */

import type { DesignKind } from "../contracts";
import { newId, parseDesignDoc, type DesignDoc, type DesignPage, type HtmlElement } from "../doc/schema";
import { FORMATS, MAX_PAGES, type FormatKey } from "../formats";
import { estimateWebHeight, splitSlides, type HtmlImportAs } from "./detect";
import { IMPORT_ROOT_CLASS } from "./css";
import { IMPORTED_PAGE_NAME } from "./imported-page";
import type { ImportRecord } from "./record";

export type BuildDocResult = { ok: true; doc: DesignDoc; format: FormatKey } | { ok: false; error: string };

/** El cuerpo de una página: dentro de la caja `.dz-import`, escalada si el archivo declara otro tamaño. */
function wrap(html: string, box: { w: number; h: number; scale: number } | null): string {
  if (!box) return `<div class="${IMPORT_ROOT_CLASS}" style="width:100%;height:100%">${html}</div>`;
  const style = `width:${box.w}px;height:${box.h}px;transform:scale(${Math.round(box.scale * 10_000) / 10_000});transform-origin:0 0`;
  return `<div class="${IMPORT_ROOT_CLASS}" style="${style}">${html}</div>`;
}

function pageOf(html: string, css: string, extra: Partial<DesignPage> = {}): DesignPage {
  const element: HtmlElement = { id: newId("el"), type: "html", name: IMPORTED_PAGE_NAME, x: 50, y: 50, w: 100, h: 100, html };
  if (css) element.css = css;
  return { id: newId("pg"), background: { type: "color", color: "#ffffff" }, elements: [element], ...extra };
}

/** Arma el documento de un archivo cargado según lo que la persona confirmó (`web` o `slides`). */
export function buildImportedDoc(record: ImportRecord, as: HtmlImportAs, kind: DesignKind): BuildDocResult {
  if (kind === "template" && as === "web") return { ok: false, error: "Una plantilla no puede ser una página web. Cargala como presentación." };
  const parts = { html: record.html, css: record.css };

  let doc: DesignDoc;
  if (as === "web") {
    const page = pageOf(`<div class="${IMPORT_ROOT_CLASS}">${record.html}</div>`, record.css, { height: estimateWebHeight(parts) });
    doc = { v: 1, format: "web", pages: [page] };
  } else {
    const slides = splitSlides(parts);
    if (slides.length === 0) return { ok: false, error: "No encontramos diapositivas en el archivo. Cargalo como página web." };
    if (slides.length > MAX_PAGES) return { ok: false, error: `El archivo tiene ${slides.length} diapositivas y el máximo es ${MAX_PAGES}. Cargalo como página web o dividilo.` };
    const format: FormatKey = record.detected.as === "slides" ? record.detected.format : "wide";
    const target = FORMATS[format];
    const size = record.detected.as === "slides" ? record.detected.sizePx : null;
    const box = size && Math.round(size.w) !== target.width ? { w: size.w, h: size.h, scale: target.width / size.w } : null;
    doc = { v: 1, format, pages: slides.map((html) => pageOf(wrap(html, box), record.css)) };
  }

  const parsed = parseDesignDoc(doc);
  if (!parsed.ok) return { ok: false, error: `El archivo no se pudo convertir en un diseño: ${parsed.problems[0] ?? "formato inválido"}.` };
  return { ok: true, doc: parsed.doc, format: parsed.doc.format };
}
