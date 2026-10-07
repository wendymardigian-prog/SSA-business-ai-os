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
