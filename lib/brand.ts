/**
 * Config de marca, blanco (white label).
 *
 * El sistema se duplica para cada cliente: nombre, logo y color salen de
 * variables de entorno, nunca de un valor escrito en el codigo. Sin
 * configurar, el sistema no muestra la marca de ningun cliente en particular:
 * usa un nombre generico.
 *
 * Modulo puro, sin imports: se puede usar tanto en Server Components como en
 * Client Components, y en el <script> inline de app/layout.tsx.
 */

const DEFAULT_NAME = "Panel";

/** Nombre del producto para esta copia. `NEXT_PUBLIC_BRAND_NAME` en Railway. */
export function brandName(): string {
  return process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || DEFAULT_NAME;
}

/** URL del logo para esta copia, si hay uno. `NEXT_PUBLIC_BRAND_LOGO_URL`. */
export function brandLogoUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_BRAND_LOGO_URL?.trim();
  return url || null;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Color principal de marca, en hex (#rrggbb). `NEXT_PUBLIC_BRAND_COLOR`.
 *
 * Se valida con una regex estricta porque este valor se inyecta como texto en
 * un <style> (ver app/layout.tsx): un valor invalido se descarta en vez de
 * dejar pasar CSS arbitrario.
 */
export function brandColorHex(): string | null {
  const value = process.env.NEXT_PUBLIC_BRAND_COLOR?.trim();
  if (!value) return null;
  return HEX_COLOR.test(value) ? value : null;
}

/** La inicial para el monograma cuando no hay logo. */
export function brandInitial(): string {
  const name = brandName().trim();
  return (name[0] ?? "P").toUpperCase();
}

// ------------------------------------------------------------
// Marca de UN negocio (00266)
//
// Una instalacion puede tener varios negocios del mismo dueño. Cada uno puede
// tener su nombre, logo y color (`workspaces.brand_*`); lo que no tenga sale
// de la marca de la instalacion de arriba. Un workspace sin marca propia se
// ve exactamente igual que antes.
//
// Todo lo que ve un lead (formularios, contratos, agenda, emails) y el panel
// de adentro usan `resolveBrand(workspace)`. El login, el icono de la pestaña
// y las paginas publicas siguen con la de la instalacion: se ven antes de saber
// de que negocio se trata.
// ------------------------------------------------------------

/** Las columnas de marca de `workspaces`. Todas opcionales: una fila vieja no las trae. */
export interface WorkspaceBrandFields {
  brand_name?: string | null;
  brand_logo_path?: string | null;
  brand_color?: string | null;
}

export interface Brand {
  name: string;
  logoUrl: string | null;
  colorHex: string | null;
  /** La inicial para el monograma cuando no hay logo. */
  initial: string;
}

export const BRAND_ASSETS_BUCKET = "brand-assets";

/** La URL publica de un logo del bucket `brand-assets` (es publico: va en emails). */
export function brandLogoPublicUrl(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!base || !path) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${BRAND_ASSETS_BUCKET}/${encoded}`;
}

/** Un color #rrggbb, o null si no es uno (se inyecta en un <style>: nunca CSS arbitrario). */
export function safeBrandColor(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && HEX_COLOR.test(v) ? v : null;
}

/**
 * La marca de un negocio. Campo por campo, lo propio y si no lo de la
 * instalacion, con una excepcion: un negocio con nombre propio y sin logo
 * muestra su inicial, NUNCA el logo de la instalacion (seria el logo de otro
 * negocio al lado de su nombre).
 */
export function resolveBrand(workspace?: WorkspaceBrandFields | null): Brand {
  const ownName = workspace?.brand_name?.trim() || null;
  const ownLogo = workspace?.brand_logo_path ? brandLogoPublicUrl(workspace.brand_logo_path) : null;
  const name = ownName ?? brandName();
  const logoUrl = ownLogo ?? (ownName ? null : brandLogoUrl());
  const colorHex = safeBrandColor(workspace?.brand_color) ?? brandColorHex();
  return { name, logoUrl, colorHex, initial: (name.trim()[0] ?? "P").toUpperCase() };
}

// ------------------------------------------------------------
// Legibilidad del color de marca
//
// Un negocio puede elegir cualquier color, tambien uno muy claro (amarillo,
// celeste, crema). Lo que va ENCIMA del color (el texto de un boton, la
// inicial del monograma) no puede ser siempre blanco: se elige entre un claro
// y un oscuro el que mas contraste tiene contra ese fondo (formula de WCAG).
// Y lo que usa el color COMO texto sobre blanco (un link en un email) se
// oscurece lo justo para que se lea.
// ------------------------------------------------------------

/** El texto claro y el oscuro que se ponen encima del color de marca. */
export const BRAND_TEXT_LIGHT = "#ffffff";
export const BRAND_TEXT_DARK = "#111827";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** La luminancia relativa de WCAG (0 = negro, 1 = blanco). */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** El contraste de WCAG entre dos colores #rrggbb (de 1 a 21; 4,5 es lo minimo para texto normal). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * El color del texto que va ENCIMA del color de marca: claro sobre un color
 * oscuro, oscuro sobre uno claro (el que mas contraste tenga). Un valor que no
 * es un hex valido devuelve el claro, como siempre fueron los botones.
 */
export function readableTextOn(hex: string | null | undefined): string {
  const color = safeBrandColor(hex);
  if (!color) return BRAND_TEXT_LIGHT;
  return contrastRatio(color, BRAND_TEXT_LIGHT) >= contrastRatio(color, BRAND_TEXT_DARK) ? BRAND_TEXT_LIGHT : BRAND_TEXT_DARK;
}

/** Mezcla `hex` con `other`: `amount` 0 = `hex` tal cual, 1 = `other`. Los dos ya validados. */
export function mixHex(hex: string, other: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  const t = Math.min(1, Math.max(0, amount));
  return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/**
 * El color de marca para usar COMO TEXTO sobre un fondo blanco (un link, un
 * titulo chico): el mismo color si ya se lee (contraste 4,5), si no, oscurecido
 * de a poco hasta que se lea. Un color claro nunca queda como texto ilegible.
 */
export function readableInkOnWhite(hex: string | null | undefined): string {
  const color = safeBrandColor(hex);
  if (!color) return BRAND_TEXT_DARK;
  for (let step = 0; step <= 20; step++) {
    const candidate = mixHex(color, "#000000", step * 0.05);
    if (contrastRatio(candidate, "#ffffff") >= 4.5) return candidate;
  }
  return BRAND_TEXT_DARK;
}

/**
 * El CSS que pinta el color principal. Recibe un hex YA validado
 * (`brandColorHex` o `safeBrandColor`): se inyecta como texto en un <style>.
 *
 * Pisa tambien el color del texto que va encima (`--primary-foreground`): sin
 * eso, un color claro dejaba los botones con letras blancas ilegibles.
 */
export function brandColorCss(hex: string): string {
  const color = safeBrandColor(hex);
  if (!color) return "";
  const text = readableTextOn(color);
  return `:root,.dark,[data-theme="dark"],[data-theme="light"]{--primary:${color} !important;--ring:${color} !important;--color-primary:${color} !important;--color-ring:${color} !important;--primary-foreground:${text} !important;--color-primary-foreground:${text} !important;}`;
}
