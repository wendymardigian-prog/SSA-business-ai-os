/**
 * Tipografías del Diseñador IA (F11).
 *
 * Tres orígenes: la lista curada de 60 familias de Google Fonts (las que ofrece
 * el desplegable agrupadas), "Otra fuente de Google" (cualquier familia que
 * exista, guardada en `design_settings.fonts.google`) y las subidas por el
 * negocio (`design_settings.fonts.uploaded`, en `design-assets/<ws>/fonts/`).
 *
 * Google devuelve 400 a TODO el pedido si se le pide un peso que una familia no
 * tiene, así que los pesos se ajustan al más cercano disponible y nunca se pide
 * cursiva (el navegador la sintetiza): una fuente mal pedida no puede tirar las
 * demás.
 *
 * Módulo puro.
 */

export type FontCategory = "sans" | "titulos" | "serif" | "manuscritas" | "mono";

export const FONT_CATEGORY_LABELS: Record<FontCategory, string> = {
  sans: "Sans",
  titulos: "Títulos",
  serif: "Serif",
  manuscritas: "Manuscritas",
  mono: "Monoespaciadas",
};

export interface CuratedFont {
  family: string;
  category: FontCategory;
  weights: readonly number[];
}

const range = (from: number, to: number) => Array.from({ length: (to - from) / 100 + 1 }, (_, i) => from + i * 100);

export const CURATED_FONTS: readonly CuratedFont[] = [
  // Sans
  { family: "Inter", category: "sans", weights: range(100, 900) },
  { family: "Montserrat", category: "sans", weights: range(100, 900) },
  { family: "Poppins", category: "sans", weights: range(100, 900) },
  { family: "Space Grotesk", category: "sans", weights: range(300, 700) },
  { family: "DM Sans", category: "sans", weights: range(100, 900) },
  { family: "Manrope", category: "sans", weights: range(200, 800) },
  { family: "Roboto", category: "sans", weights: [100, 300, 400, 500, 700, 900] },
  { family: "Open Sans", category: "sans", weights: range(300, 800) },
  { family: "Lato", category: "sans", weights: [100, 300, 400, 700, 900] },
  { family: "Nunito", category: "sans", weights: range(200, 900) },
  { family: "Work Sans", category: "sans", weights: range(100, 900) },
  { family: "Rubik", category: "sans", weights: range(300, 900) },
  { family: "Outfit", category: "sans", weights: range(100, 900) },
  { family: "Plus Jakarta Sans", category: "sans", weights: range(200, 800) },
  { family: "Raleway", category: "sans", weights: range(100, 900) },
  { family: "Figtree", category: "sans", weights: range(300, 900) },
  // Títulos
  { family: "Bebas Neue", category: "titulos", weights: [400] },
  { family: "Archivo Black", category: "titulos", weights: [400] },
  { family: "Oswald", category: "titulos", weights: range(200, 700) },
  { family: "Anton", category: "titulos", weights: [400] },
  { family: "Archivo", category: "titulos", weights: range(100, 900) },
  { family: "League Spartan", category: "titulos", weights: range(100, 900) },
  { family: "Syne", category: "titulos", weights: range(400, 800) },
  { family: "Sora", category: "titulos", weights: range(100, 800) },
  { family: "Unbounded", category: "titulos", weights: range(200, 900) },
  { family: "Righteous", category: "titulos", weights: [400] },
  { family: "Alfa Slab One", category: "titulos", weights: [400] },
  { family: "Abril Fatface", category: "titulos", weights: [400] },
  { family: "Barlow Condensed", category: "titulos", weights: range(100, 900) },
  { family: "Teko", category: "titulos", weights: range(300, 700) },
  // Serif
  { family: "Playfair Display", category: "serif", weights: range(400, 900) },
  { family: "DM Serif Display", category: "serif", weights: [400] },
  { family: "Lora", category: "serif", weights: range(400, 700) },
  { family: "Fraunces", category: "serif", weights: range(100, 900) },
  { family: "Merriweather", category: "serif", weights: [300, 400, 700, 900] },
  { family: "Libre Baskerville", category: "serif", weights: [400, 700] },
  { family: "Cormorant Garamond", category: "serif", weights: range(300, 700) },
  { family: "EB Garamond", category: "serif", weights: range(400, 800) },
  { family: "Crimson Text", category: "serif", weights: [400, 600, 700] },
  { family: "Source Serif 4", category: "serif", weights: range(200, 900) },
  { family: "Roboto Slab", category: "serif", weights: range(100, 900) },
  { family: "Cinzel", category: "serif", weights: range(400, 900) },
  { family: "Bodoni Moda", category: "serif", weights: range(400, 900) },
  { family: "Spectral", category: "serif", weights: range(200, 800) },
  // Manuscritas
  { family: "Caveat", category: "manuscritas", weights: range(400, 700) },
  { family: "Kalam", category: "manuscritas", weights: [300, 400, 700] },
  { family: "Dancing Script", category: "manuscritas", weights: range(400, 700) },
  { family: "Pacifico", category: "manuscritas", weights: [400] },
  { family: "Great Vibes", category: "manuscritas", weights: [400] },
  { family: "Satisfy", category: "manuscritas", weights: [400] },
  { family: "Shadows Into Light", category: "manuscritas", weights: [400] },
  { family: "Permanent Marker", category: "manuscritas", weights: [400] },
  { family: "Sacramento", category: "manuscritas", weights: [400] },
  { family: "Patrick Hand", category: "manuscritas", weights: [400] },
  // Monoespaciadas
  { family: "JetBrains Mono", category: "mono", weights: range(100, 800) },
  { family: "Space Mono", category: "mono", weights: [400, 700] },
  { family: "IBM Plex Mono", category: "mono", weights: range(100, 700) },
  { family: "Fira Code", category: "mono", weights: range(300, 700) },
  { family: "Roboto Mono", category: "mono", weights: range(100, 700) },
  { family: "Source Code Pro", category: "mono", weights: range(200, 900) },
];

const CURATED_BY_FAMILY = new Map(CURATED_FONTS.map((f) => [f.family, f]));

/** Un nombre de familia aceptable: letras, números y espacios, como los de Google Fonts. */
export const FONT_FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/;

export function isCuratedFont(family: string): boolean {
  return CURATED_BY_FAMILY.has(family);
}

export function curatedFont(family: string): CuratedFont | undefined {
  return CURATED_BY_FAMILY.get(family);
}

/** El peso disponible más cercano (a igual distancia, el más pesado). */
export function nearestWeight(available: readonly number[], wanted: number): number {
  if (available.length === 0) return 400;
  return [...available].sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || b - a)[0];
}

export interface FontUse {
  family: string;
  weights: readonly number[];
}

/**
 * Una sola URL de Google Fonts (CSS2) con todas las familias y pesos usados.
 * Las curadas piden sus pesos ajustados al disponible más cercano; las demás
 * (agregadas con "Otra fuente de Google") se piden sin pesos (regular) porque no
 * se sabe cuáles tienen. `null` si no hay nada que pedir.
 */
export function googleCssUrl(uses: readonly FontUse[]): string | null {
  const byFamily = new Map<string, Set<number>>();
  for (const use of uses) {
    if (!FONT_FAMILY_RE.test(use.family)) continue;
    const set = byFamily.get(use.family) ?? new Set<number>();
    const curated = CURATED_BY_FAMILY.get(use.family);
    for (const w of use.weights) set.add(curated ? nearestWeight(curated.weights, w) : w);
    byFamily.set(use.family, set);
  }
  if (byFamily.size === 0) return null;
  const params = [...byFamily.keys()].sort().map((family) => {
    const name = family.replace(/ /g, "+");
    const curated = CURATED_BY_FAMILY.has(family);
    const weights = [...(byFamily.get(family) ?? [])].sort((a, b) => a - b);
    return curated && weights.length > 0 ? `family=${name}:wght@${weights.join(";")}` : `family=${name}`;
  });
  return `https://fonts.googleapis.com/css2?${params.join("&")}&display=swap`;
}

/** La URL con la que el servidor comprueba que una familia existe en Google (200 = existe). */
export function googleFamilyCheckUrl(family: string): string | null {
  if (!FONT_FAMILY_RE.test(family.trim())) return null;
  return `https://fonts.googleapis.com/css2?family=${family.trim().replace(/ /g, "+")}`;
}

export type FontFileFormat = "woff2" | "woff" | "ttf" | "otf";

/** El formato de una fuente por sus primeros bytes (nunca por la extensión). `null` si no es una fuente. */
export function sniffFont(bytes: Uint8Array): FontFileFormat | null {
  if (bytes.length < 4) return null;
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (sig === "wOF2") return "woff2";
  if (sig === "wOFF") return "woff";
  if (sig === "OTTO") return "otf";
  if (sig === "true") return "ttf";
  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return "ttf";
  return null;
}

export const MAX_FONT_BYTES = 2 * 1024 * 1024;

export type FontUploadCheck = { ok: true; format: FontFileFormat } | { ok: false; error: string };

/** Lo que se valida antes de subir una fuente: tamaño y que los bytes sean de una fuente. */
export function checkFontUpload(bytes: Uint8Array): FontUploadCheck {
  if (bytes.length === 0) return { ok: false, error: "El archivo está vacío." };
  if (bytes.length > MAX_FONT_BYTES) return { ok: false, error: "La fuente pesa más de 2 MB." };
  const format = sniffFont(bytes);
  if (!format) return { ok: false, error: "El archivo no es una fuente (.woff2, .woff, .ttf u .otf)." };
  return { ok: true, format };
}

/** El aviso de licencia que acompaña a "Subir mi fuente". */
export const FONT_LICENSE_NOTICE = "Si la fuente es paga, la licencia corre por tu cuenta.";

export interface UploadedFont {
  family: string;
  weight: number;
  style: "normal" | "italic";
  path: string;
  format: FontFileFormat;
}

const CSS_FORMAT: Record<FontFileFormat, string> = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

/** Las reglas `@font-face` de las fuentes subidas, con la URL que da `assetUrl` (link firmado). */
export function uploadedFontFaces(fonts: readonly UploadedFont[], assetUrl: (path: string) => string): string {
  return fonts
    .filter((f) => FONT_FAMILY_RE.test(f.family))
    .map((f) => {
      const url = assetUrl(f.path).replace(/["\\\n\r]/g, "");
      return `@font-face{font-family:"${f.family}";src:url("${url}") format("${CSS_FORMAT[f.format]}");font-weight:${f.weight};font-style:${f.style};font-display:swap}`;
    })
    .join("");
}

/** Las familias agrupadas para el desplegable (F21): curadas por categoría, Google agregadas y subidas. */
export function fontGroups(input: { google?: readonly string[]; uploaded?: readonly UploadedFont[] }): { label: string; families: string[] }[] {
  const groups: { label: string; families: string[] }[] = [];
  for (const category of Object.keys(FONT_CATEGORY_LABELS) as FontCategory[]) {
    groups.push({ label: FONT_CATEGORY_LABELS[category], families: CURATED_FONTS.filter((f) => f.category === category).map((f) => f.family) });
  }
  const google = [...new Set(input.google ?? [])].filter((f) => !isCuratedFont(f));
  if (google.length) groups.push({ label: "Agregadas de Google", families: google });
  const uploaded = [...new Set((input.uploaded ?? []).map((f) => f.family))];
  if (uploaded.length) groups.push({ label: "Subidas", families: uploaded });
  return groups;
}
