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
// y el sitio publico siguen con la de la instalacion: se ven antes de saber
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

/**
 * El CSS que pinta el color principal. Recibe un hex YA validado
 * (`brandColorHex` o `safeBrandColor`): se inyecta como texto en un <style>.
 */
export function brandColorCss(hex: string): string {
  const color = safeBrandColor(hex);
  if (!color) return "";
  return `:root,.dark,[data-theme="dark"],[data-theme="light"]{--primary:${color} !important;--ring:${color} !important;--color-primary:${color} !important;--color-ring:${color} !important;}`;
}
