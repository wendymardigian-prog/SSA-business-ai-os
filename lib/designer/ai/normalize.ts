/**
 * Deja un documento que armó la IA listo para validarse (F32).
 *
 * La IA acierta casi todo pero tropieza siempre en lo mismo: ids que faltan,
 * una fuente que no está en la lista, un porcentaje que se pasa de 100, una
 * imagen con un nombre que no existe. Eso se arregla acá, de forma
 * determinista y SIN inventar contenido; lo que no se puede arreglar queda
 * como está y lo atrapa `parseDesignDoc` (que dispara el reintento).
 *
 * Módulo puro.
 */

import { ELEMENT_ID_RE, PAGE_ID_RE, newId } from "../doc/schema";
import { curatedFont, nearestWeight } from "../fonts";
import type { AssetAliases } from "./assets";
import type { FormatKey } from "../formats";

/** Un valor simple para tratar el documento como árbol sin tipos. */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Las letras y números en minúscula, sin tildes ni espacios: para comparar nombres de fuente. */
function squash(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** La distancia de edición entre dos textos (Levenshtein). */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * La familia permitida más cercana a lo que escribió la IA (o a una fuente de
 * una imagen). Igual sin importar mayúsculas ni espacios; si no, la de menor
 * distancia, con ventaja a las que contienen el nombre. Siempre devuelve una
 * (la primera de la lista si no hay ninguna parecida).
 */
export function closestFontFamily(name: string, allowed: readonly string[]): string {
  if (allowed.length === 0) return name;
  const wanted = squash(name);
  if (!wanted) return allowed[0];
  const exact = allowed.find((f) => squash(f) === wanted);
  if (exact) return exact;
  let best = allowed[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const family of allowed) {
    const candidate = squash(family);
    let score = distance(wanted, candidate) / Math.max(wanted.length, candidate.length);
    if (candidate.includes(wanted) || wanted.includes(candidate)) score -= 0.3;
    if (score < bestScore) {
      best = family;
      bestScore = score;
    }
  }
  return best;
}

export interface NormalizeContext {
  format: FormatKey;
  /** Las familias permitidas (curadas, de Google agregadas, subidas y las del estilo). */
  allowedFonts: readonly string[];
  /** Traduce los nombres cortos de imagen a rutas reales. */
  assets: AssetAliases;
  /** El color de fondo de respaldo si una imagen no existe. */
  fallbackBackground: string;
  /** La clave del estilo que queda en el documento. */
  styleKey?: string;
}

export interface NormalizeResult {
  doc: unknown;
  warnings: string[];
}

const clamp = (n: unknown, min: number, max: number): unknown => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : n);

function normalizeFont(el: Obj, ctx: NormalizeContext): void {
  if (!isObj(el.font)) return;
  const family = typeof el.font.family === "string" ? el.font.family : "";
  const fixed = closestFontFamily(family, ctx.allowedFonts);
  el.font.family = fixed;
  const curated = curatedFont(fixed);
  if (typeof el.font.weight === "number" && curated) el.font.weight = nearestWeight(curated.weights, el.font.weight);
}

/**
 * Normaliza un documento (completo, o el resultado de aplicar un parche).
 * Trabaja sobre una copia: no toca lo que recibe.
 */
export function normalizeDoc(input: unknown, ctx: NormalizeContext): NormalizeResult {
  const warnings: string[] = [];
  if (!isObj(input)) return { doc: input, warnings };
  const doc = structuredClone(input) as Obj;
  doc.v = 1;
  doc.format = ctx.format;
  if (ctx.styleKey) doc.style = ctx.styleKey;
  const pages = Array.isArray(doc.pages) ? (doc.pages as unknown[]) : [];
  const pageIds = new Set<string>();
  const elementIds = new Set<string>();
  let droppedImages = 0;
  let droppedBackgrounds = 0;

  for (const rawPage of pages) {
    if (!isObj(rawPage)) continue;
    if (typeof rawPage.id !== "string" || !PAGE_ID_RE.test(rawPage.id) || pageIds.has(rawPage.id)) rawPage.id = newId("pg");
    pageIds.add(rawPage.id as string);
    if (ctx.format !== "web") delete rawPage.height;

    // Fondo: una imagen que no existe cae a un color liso.
    if (isObj(rawPage.background)) {
      const bg = rawPage.background;
      if (bg.type === "image" && isObj(bg.image)) {
        const path = typeof bg.image.asset === "string" ? ctx.assets.resolve(bg.image.asset) : null;
        if (!path) {
          droppedBackgrounds++;
          rawPage.background = { type: "color", color: ctx.fallbackBackground };
        } else {
          bg.image.asset = path;
          if (isObj(bg.image.focal)) {
            bg.image.focal.x = clamp(bg.image.focal.x, 0, 100);
            bg.image.focal.y = clamp(bg.image.focal.y, 0, 100);
          } else {
            bg.image.focal = { x: 50, y: 50 };
          }
          if (typeof bg.image.locked !== "boolean") bg.image.locked = false;
        }
      }
      if (isObj(rawPage.background) && isObj((rawPage.background as Obj).overlay)) {
        const overlay = (rawPage.background as Obj).overlay as Obj;
        overlay.opacity = clamp(overlay.opacity, 0, 0.9);
      }
    }

    if (!Array.isArray(rawPage.elements)) continue;
    const kept: unknown[] = [];
    for (const rawEl of rawPage.elements as unknown[]) {
      if (!isObj(rawEl)) continue;
      if (rawEl.type === "image") {
        const path = typeof rawEl.asset === "string" ? ctx.assets.resolve(rawEl.asset) : null;
        if (!path) {
          droppedImages++;
          continue;
        }
        rawEl.asset = path;
      }
      if (typeof rawEl.id !== "string" || !ELEMENT_ID_RE.test(rawEl.id) || elementIds.has(rawEl.id)) rawEl.id = newId("el");
      elementIds.add(rawEl.id as string);
      rawEl.x = clamp(rawEl.x, 0, 100);
      rawEl.y = clamp(rawEl.y, 0, 100);
      if (typeof rawEl.w === "number") rawEl.w = clamp(rawEl.w, 0.5, 100);
      if (typeof rawEl.h === "number") rawEl.h = clamp(rawEl.h, 0.5, 100);
      if (typeof rawEl.opacity === "number") rawEl.opacity = clamp(rawEl.opacity, 0, 1);
      if (rawEl.type === "text") {
        delete rawEl.h; // los textos no llevan alto
        normalizeFont(rawEl, ctx);
        if (isObj(rawEl.highlight)) rawEl.highlight.opacity = clamp(rawEl.highlight.opacity, 0, 1);
      }
      kept.push(rawEl);
    }
    rawPage.elements = kept;
  }

  if (droppedImages > 0) warnings.push(droppedImages === 1 ? "Saqué una imagen que no existe." : `Saqué ${droppedImages} imágenes que no existen.`);
  if (droppedBackgrounds > 0) warnings.push("Cambié por un color liso un fondo con una imagen que no existe.");
  return { doc, warnings };
}
