/**
 * La revisión automática del Diseñador IA (F36): los cinco chequeos.
 *
 *   1. overflow   — un texto se desborda de su caja (medido por el servicio de render);
 *   2. contrast   — el color del texto contra la luminancia MEDIDA del fondo detrás de él;
 *   3. safe_zone  — un texto fuera de la zona segura del formato;
 *   4. font_size  — letras por debajo del mínimo del formato;
 *   5. words      — más palabras por página que las que admite el estilo.
 *
 * Los tres últimos no necesitan el servicio de render; los dos primeros sí.
 * Sin medición (`measure = null`) se hacen solo los que se pueden y la zona
 * segura se estima con el documento. Una numeración «N/M» chica en una
 * esquina no cuenta como tamaño ni como palabras: es parte del estilo.
 *
 * `fixOverlays` corrige sin llamar a la IA lo más común: poco contraste sobre
 * una foto se arregla con la capa de color (se calcula la opacidad que alcanza).
 *
 * Módulo puro.
 */

import { contrastFromLuminance, minContrastFor, overlayForContrast, relativeLuminance } from "../color";
import type { DesignDoc, DesignPage, TextElement } from "../doc/schema";
import { FORMATS, type FormatKey } from "../formats";
import type { MeasuredElement, MeasuredPage } from "../render-client";
import { wordsPerPage, type DesignStyle } from "../styles";
import { safeBounds } from "./rules";

export const QA_KINDS = ["overflow", "contrast", "safe_zone", "font_size", "words"] as const;
export type QaKind = (typeof QA_KINDS)[number];

export interface QaIssue {
  kind: QaKind;
  /** La página (0 = la primera). */
  page: number;
  elementId?: string;
  /** Un dato corto para la IA y para el aviso (`2,1:1`, `18 de 25`). */
  detail: string;
}

/** Cuántas veces como máximo se le pide a la IA que corrija lo que encontró la revisión. */
export const MAX_CORRECTION_PASSES = 2;

/** Una numeración tipo «3/7». */
const PAGINATION = /^\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/;
const isPagination = (el: TextElement) => PAGINATION.test(el.text);

/** Las palabras de un texto: cada variable cuenta como una. */
export function countWords(text: string): number {
  const plain = text.replace(/\{\{[^{}]*\}\}/g, " x ");
  return plain.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** El alto estimado de un texto en % de la página (cuando no hay medición). */
export function estimateTextHeightPct(el: TextElement, format: FormatKey, pageHeight: number): number {
  const def = FORMATS[format];
  const widthPx = Math.max(1, (el.w / 100) * def.width);
  const perLine = Math.max(1, Math.floor(widthPx / (el.size * 0.55 + (el.letterSpacing ?? 0))));
  const lines = el.text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return ((lines * el.size * (el.lineHeight ?? 1.2)) / pageHeight) * 100;
}

function measuredIndex(measure: readonly MeasuredPage[] | null): Map<number, Map<string, MeasuredElement>> {
  const index = new Map<number, Map<string, MeasuredElement>>();
  for (const page of measure ?? []) index.set(page.page, new Map(page.elements.map((e) => [e.id, e])));
  return index;
}

const TOLERANCE = 0.6; // % de la página

/** Detecta los cinco problemas. `measure` es la medición del servicio de render, o `null` si no la hay. */
export function qaIssues(measure: readonly MeasuredPage[] | null, doc: DesignDoc, format: FormatKey, style?: DesignStyle): QaIssue[] {
  const def = FORMATS[format];
  const bounds = safeBounds(format);
  const maxWords = wordsPerPage(style, format);
  const measured = measuredIndex(measure);
  const issues: QaIssue[] = [];

  doc.pages.forEach((page, pageIndex) => {
    const pageHeight = format === "web" ? (page.height ?? def.height) : def.height;
    const onPage = measured.get(pageIndex);
    let words = 0;
    for (const el of page.elements) {
      if (el.type !== "text" || el.hidden) continue;
      const numbering = isPagination(el);
      if (!numbering) words += countWords(el.text);
      if (!numbering && el.size < def.minFontSize) issues.push({ kind: "font_size", page: pageIndex, elementId: el.id, detail: `${el.size} px (mínimo ${def.minFontSize})` });

      const box = onPage?.get(el.id);
      let left: number;
      let right: number;
      let top: number;
      let bottom: number;
      if (box) {
        left = (box.x / def.width) * 100;
        right = ((box.x + box.w) / def.width) * 100;
        top = (box.y / pageHeight) * 100;
        bottom = ((box.y + box.h) / pageHeight) * 100;
      } else {
        const h = estimateTextHeightPct(el, format, pageHeight);
        left = el.x - el.w / 2;
        right = el.x + el.w / 2;
        top = el.y - h / 2;
        bottom = el.y + h / 2;
      }
      const verticalAdjust = format === "web" ? 0 : 1;
      if (left < bounds.minX - TOLERANCE || right > bounds.maxX + TOLERANCE || (verticalAdjust && (top < bounds.minY - TOLERANCE || bottom > bounds.maxY + TOLERANCE))) {
        issues.push({ kind: "safe_zone", page: pageIndex, elementId: el.id, detail: "fuera de la zona segura" });
      }

      if (box?.overflow) issues.push({ kind: "overflow", page: pageIndex, elementId: el.id, detail: "el texto se sale de su caja" });

      if (box && box.bgLuminance !== null && !numbering) {
        const ratio = contrastFromLuminance(relativeLuminance(el.color), box.bgLuminance);
        const needed = minContrastFor(el.size, def.minFontSize);
        if (ratio < needed) issues.push({ kind: "contrast", page: pageIndex, elementId: el.id, detail: `${ratio.toFixed(1).replace(".", ",")}:1 (mínimo ${String(needed).replace(".", ",")}:1)` });
      }
    }
    if (words > maxWords) issues.push({ kind: "words", page: pageIndex, detail: `${words} de máximo ${maxWords}` });
  });
  return issues;
}

/** Las páginas (0-based) con algún problema, sin repetir y en orden. */
export function issuePages(issues: readonly QaIssue[]): number[] {
  return [...new Set(issues.map((i) => i.page))].sort((a, b) => a - b);
}

const hasImageBackground = (page: DesignPage | undefined) => page?.background.type === "image";

/** El aviso de un problema, en palabras para la persona («La página 4 tiene poco contraste: subí la capa de color»). */
export function qaMessage(issue: QaIssue, doc?: DesignDoc): string {
  const n = issue.page + 1;
  switch (issue.kind) {
    case "contrast":
      return hasImageBackground(doc?.pages[issue.page]) ? `La página ${n} tiene poco contraste: subí la capa de color.` : `La página ${n} tiene poco contraste: cambiá el color del texto o del fondo.`;
    case "overflow":
      return `En la página ${n} hay un texto que se sale de su caja: achicalo o agrandá la caja.`;
    case "safe_zone":
      return `En la página ${n} hay un texto fuera de la zona segura: movelo hacia adentro.`;
    case "font_size":
      return `En la página ${n} hay letras por debajo del mínimo del formato (${issue.detail}).`;
    case "words":
      return `La página ${n} tiene demasiadas palabras (${issue.detail}).`;
  }
}

/** Los avisos para la respuesta: uno por tipo de problema y página, con tope. */
export function qaWarnings(issues: readonly QaIssue[], doc?: DesignDoc, limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const issue of [...issues].sort((a, b) => a.page - b.page || QA_KINDS.indexOf(a.kind) - QA_KINDS.indexOf(b.kind))) {
    const key = `${issue.page}:${issue.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(qaMessage(issue, doc));
  }
  if (out.length <= limit) return out;
  return [...out.slice(0, limit), `Y ${out.length - limit} avisos más de la revisión automática.`];
}

/** La lista de problemas para pasársela a la IA en la pasada de corrección (con los id de los elementos). */
export function qaProblemsForPrompt(issues: readonly QaIssue[]): string[] {
  return issues.map((i) => `Página ${i.page + 1} (index ${i.page})${i.elementId ? `, elemento ${i.elementId}` : ""}: ${i.kind} · ${i.detail}`);
}

/** Lo que queda en `designs.last_qa` (solo diseños). */
export interface StoredQa {
  at: string;
  issues: { kind: QaKind; page: number; elementId?: string; detail: string }[];
  unchecked: string[];
}

export function storedQa(issues: readonly QaIssue[], unchecked: readonly string[], now: Date): StoredQa {
  return { at: now.toISOString(), issues: issues.map((i) => ({ ...i })), unchecked: [...unchecked] };
}

/**
 * La luminancia de la foto SIN la capa de color, a partir de la luminancia
 * medida (que ya la incluye): inversa de `mixOverlay`.
 */
export function unmixOverlay(measuredLuminance: number, overlayColor: string, opacity: number): number {
  if (opacity >= 0.95) return measuredLuminance;
  const raw = (measuredLuminance - relativeLuminance(overlayColor) * opacity) / (1 - opacity);
  return Math.min(1, Math.max(0, raw));
}

/**
 * Sube la capa de color de las páginas con foto y poco contraste hasta lo que
 * alcanza (sin llamar a la IA). Devuelve el documento nuevo y las páginas que
 * cambió; si ni con 90 % alcanza, esa página no se toca (queda para la IA).
 */
export function fixOverlays(doc: DesignDoc, issues: readonly QaIssue[], measure: readonly MeasuredPage[] | null, format: FormatKey): { doc: DesignDoc; fixedPages: number[] } {
  const def = FORMATS[format];
  const measured = measuredIndex(measure);
  const next = structuredClone(doc);
  const fixed: number[] = [];

  for (const index of new Set(issues.filter((i) => i.kind === "contrast").map((i) => i.page))) {
    const page = next.pages[index];
    if (!page || page.background.type !== "image") continue;
    const current = page.background.overlay;
    const firstText = issues.map((i) => (i.kind === "contrast" && i.page === index ? page.elements.find((e) => e.id === i.elementId) : undefined)).find((e): e is TextElement => e?.type === "text");
    // Sin capa todavía: oscura para letras claras, clara para letras oscuras.
    const overlayColor = current?.color ?? (firstText && relativeLuminance(firstText.color) < 0.4 ? "#ffffff" : "#0f1115");
    const opacity = current?.opacity ?? 0;
    let needed = opacity;
    let possible = true;
    for (const issue of issues.filter((i) => i.kind === "contrast" && i.page === index)) {
      const el = page.elements.find((e) => e.id === issue.elementId);
      const box = el ? measured.get(index)?.get(el.id) : undefined;
      if (!el || el.type !== "text" || !box || box.bgLuminance === null) continue;
      const photo = unmixOverlay(box.bgLuminance, overlayColor, opacity);
      const wanted = overlayForContrast(el.color, photo, overlayColor, minContrastFor(el.size, def.minFontSize));
      if (wanted === null) {
        possible = false;
        break;
      }
      needed = Math.max(needed, wanted);
    }
    if (!possible || needed <= opacity) continue;
    page.background.overlay = { color: overlayColor, opacity: Math.min(0.9, needed) };
    fixed.push(index);
  }
  return { doc: next, fixedPages: fixed };
}
