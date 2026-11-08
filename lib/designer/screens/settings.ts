/**
 * La lógica de «Ajustes del Diseñador IA» (§11.8): estilos propios y fuentes.
 * Los componentes (`components/designer/settings/*`) solo la componen.
 *
 * Módulo puro.
 */

import { normalizeHexInput } from "../color";
import type { FormatKey } from "../formats";
import { FONT_FAMILY_RE, googleCssUrl, type FontUse } from "../fonts";
import type { UploadedFontEntry } from "../settings-schema";
import { STYLE_KEY_RE, type DesignStyle } from "../styles";
import { MAX_STYLE_IMAGE_BYTES, MAX_STYLE_IMAGES, MIN_STYLE_IMAGES } from "../ai/style-extract";

// ─── Estilos propios ────────────────────────────────────────────────────────

/** Los grupos de densidad que se editan (palabras por página): un campo para varios formatos. */
export const DENSITY_FIELDS: { key: string; label: string; formats: FormatKey[]; fallback: number }[] = [
  { key: "social", label: "Posts (cuadrado y 4:5)", formats: ["sq", "v45"], fallback: 25 },
  { key: "story", label: "Historias", formats: ["story"], fallback: 18 },
  { key: "wide", label: "Presentaciones", formats: ["wide"], fallback: 40 },
  { key: "print", label: "Documentos impresos", formats: ["carta_v", "carta_h", "a4_v", "a4_h"], fallback: 120 },
  { key: "web", label: "Páginas web", formats: ["web"], fallback: 400 },
];

/** Lo que se edita de un estilo: textos y números como los escribe la persona. */
export interface StyleDraft {
  key: string | null;
  name: string;
  palette: { bg: string; text: string; accent: string };
  fonts: { title: string; body: string };
  density: Record<string, string>;
  rules: string;
  archived: boolean;
}

export const MAX_RULES_CHARS = 1500;

export function draftFromStyle(style: DesignStyle | null): StyleDraft {
  const density: Record<string, string> = {};
  for (const field of DENSITY_FIELDS) density[field.key] = String(style?.density[field.formats[0]] ?? field.fallback);
  return {
    key: style?.key ?? null,
    name: style?.name ?? "",
    palette: style?.palette ?? { bg: "#ffffff", text: "#111111", accent: "#4f46e5" },
    fonts: style?.fonts ?? { title: "Inter", body: "Inter" },
    density,
    rules: style?.rules ?? "",
    archived: style?.archived ?? false,
  };
}

export type DraftResult = { ok: true; style: DesignStyle } | { ok: false; problems: string[] };

/** De lo que escribió la persona al estilo que se guarda; los problemas, en español. La clave nueva la pone el servidor. */
export function styleFromDraft(draft: StyleDraft): DraftResult {
  const problems: string[] = [];
  const name = draft.name.trim();
  if (!name) problems.push("El estilo necesita un nombre.");
  if (name.length > 60) problems.push("El nombre puede tener hasta 60 caracteres.");
  const palette = { bg: normalizeHexInput(draft.palette.bg), text: normalizeHexInput(draft.palette.text), accent: normalizeHexInput(draft.palette.accent) };
  if (!palette.bg) problems.push("El color de fondo no es válido (por ejemplo #101820).");
  if (!palette.text) problems.push("El color del texto no es válido (por ejemplo #ffffff).");
  if (!palette.accent) problems.push("El color de acento no es válido (por ejemplo #f2aa4c).");
  if (!FONT_FAMILY_RE.test(draft.fonts.title)) problems.push("Elegí la fuente de los títulos.");
  if (!FONT_FAMILY_RE.test(draft.fonts.body)) problems.push("Elegí la fuente del cuerpo.");
  const density: DesignStyle["density"] = {};
  for (const field of DENSITY_FIELDS) {
    const n = Number(draft.density[field.key]);
    if (!Number.isFinite(n) || n < 5 || n > 1000) problems.push(`«${field.label}»: poné un número de palabras entre 5 y 1000.`);
    else for (const f of field.formats) density[f] = Math.round(n);
  }
  if (draft.rules.length > MAX_RULES_CHARS) problems.push(`Las reglas pueden tener hasta ${MAX_RULES_CHARS} caracteres.`);
  if (problems.length > 0 || !palette.bg || !palette.text || !palette.accent) return { ok: false, problems };
  const key = draft.key && STYLE_KEY_RE.test(draft.key) && draft.key.startsWith("c_") ? draft.key : `c_${Math.random().toString(36).slice(2, 8)}`;
  return { ok: true, style: { key, name, palette: { bg: palette.bg, text: palette.text, accent: palette.accent }, fonts: draft.fonts, density, rules: draft.rules.trim(), ...(draft.archived ? { archived: true } : {}) } };
}

export interface StyleCard {
  key: string;
  name: string;
  palette: DesignStyle["palette"];
  fonts: DesignStyle["fonts"];
  /** «Posts hasta 22 palabras · Historias hasta 16». */
  densityLine: string;
  rulesPreview: string;
  archived: boolean;
}

/** Cómo se dibuja cada estilo propio: los activos primero y los archivados aparte. */
export function styleCards(styles: readonly DesignStyle[]): { active: StyleCard[]; archived: StyleCard[] } {
  const cards = styles.map<StyleCard>((s) => {
    const parts = DENSITY_FIELDS.slice(0, 2).flatMap((f) => (s.density[f.formats[0]] !== undefined ? [`${f.label.split(" (")[0]} hasta ${s.density[f.formats[0]]}`] : []));
    return {
      key: s.key,
      name: s.name,
      palette: s.palette,
      fonts: s.fonts,
      densityLine: parts.join(" · "),
      rulesPreview: s.rules.length > 140 ? `${s.rules.slice(0, 139)}…` : s.rules,
      archived: !!s.archived,
    };
  });
  return { active: cards.filter((c) => !c.archived), archived: cards.filter((c) => c.archived) };
}

// ─── Crear un estilo desde mis piezas ───────────────────────────────────────

export interface ExtractionPick {
  count: number;
  canExtract: boolean;
  message: string | null;
}

/** Cuántas piezas hay elegidas (imágenes más diseños) y si alcanzan: entre 3 y 5. */
export function extractionPick(files: number, designs: number): ExtractionPick {
  const count = files + designs;
  if (count < MIN_STYLE_IMAGES) return { count, canExtract: false, message: `Elegí al menos ${MIN_STYLE_IMAGES} piezas (${MIN_STYLE_IMAGES - count === 1 ? "te falta 1" : `te faltan ${MIN_STYLE_IMAGES - count}`}).` };
  if (count > MAX_STYLE_IMAGES) return { count, canExtract: false, message: `Elegí hasta ${MAX_STYLE_IMAGES} piezas (${count - MAX_STYLE_IMAGES === 1 ? "sobra 1" : `sobran ${count - MAX_STYLE_IMAGES}`}).` };
  return { count, canExtract: true, message: null };
}

export function checkExtractionFile(file: { type: string; size: number }): string | null {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "Usá PNG o JPG (también WebP).";
  if (file.size > 30 * 1024 * 1024) return "La imagen pesa demasiado.";
  return null;
}

/** El tamaño al que se achica una imagen de referencia antes de mandarla (el lado mayor), conservando la proporción. */
export function downscaleSize(width: number, height: number, maxSide = 1024): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest <= 0) return { width, height };
  const k = maxSide / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Una imagen ya achicada tiene que entrar en el tope del servidor. */
export const MAX_REFERENCE_BYTES = MAX_STYLE_IMAGE_BYTES;

// ─── Fuentes ────────────────────────────────────────────────────────────────

export const WEIGHT_OPTIONS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export const WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black" };

export const weightLabel = (weight: number): string => `${WEIGHT_NAMES[weight] ?? "Regular"} ${weight}`;

export interface FontRow {
  kind: "google" | "uploaded";
  family: string;
  /** Solo subidas. */
  path?: string;
  detail: string;
}

/** Las fuentes del negocio para la tabla: las de Google agregadas y las subidas, cada una con su detalle. */
export function fontRows(input: { google: readonly string[]; uploaded: readonly UploadedFontEntry[] }): FontRow[] {
  const google = [...new Set(input.google)].sort((a, b) => a.localeCompare(b, "es")).map<FontRow>((family) => ({ kind: "google", family, detail: "De Google Fonts" }));
  const uploaded = [...input.uploaded]
    .sort((a, b) => a.family.localeCompare(b.family, "es") || a.weight - b.weight)
    .map<FontRow>((f) => ({ kind: "uploaded", family: f.family, path: f.path, detail: `${weightLabel(f.weight)}${f.style === "italic" ? " · cursiva" : ""} · .${f.format}` }));
  return [...google, ...uploaded];
}

/** La URL de Google Fonts con las familias que hay que dibujar en la pantalla (una sola). */
export function previewFontsHref(families: readonly string[]): string | null {
  const uses: FontUse[] = [...new Set(families)].map((family) => ({ family, weights: [400, 700] }));
  return googleCssUrl(uses);
}

/** Las familias que la pantalla tiene que pedir a Google: las de los estilos y las de Google agregadas (no las subidas). */
export function googleFamiliesToLoad(styles: readonly DesignStyle[], google: readonly string[], uploadedFamilies: readonly string[]): string[] {
  const own = new Set(uploadedFamilies);
  const all = new Set<string>(google);
  for (const s of styles) {
    all.add(s.fonts.title);
    all.add(s.fonts.body);
  }
  return [...all].filter((f) => !own.has(f) && FONT_FAMILY_RE.test(f));
}

/** El texto de muestra de cada fuente. */
export const FONT_SAMPLE = "Aa Bb Cc";

/** Valida lo que se ve antes de subir una fuente (el servidor valida por bytes). */
export function checkFontFile(file: { name: string; size: number }): string | null {
  if (!/\.(woff2|woff|ttf|otf)$/i.test(file.name)) return "Elegí un archivo .woff2, .woff, .ttf u .otf.";
  if (file.size > 2 * 1024 * 1024) return "La fuente pesa más de 2 MB.";
  if (file.size === 0) return "El archivo está vacío.";
  return null;
}
