/**
 * Las reglas de la seccion "Marca" de Ajustes → General (00266), puras: las
 * usa la Server Action y las prueba Vitest. La pantalla no decide nada.
 *
 * Cada campo vacio significa "usar el de la instalacion" y se guarda como
 * NULL, nunca como texto vacio: asi un negocio que no toca nada se ve igual
 * que antes.
 */

import { sniffMime } from "@/lib/content/media";
import { safeBrandColor } from "@/lib/brand";

export const BRAND_NAME_MAX = 60;
export const LANGUAGE_STYLE_MAX = 200;
export const MAX_LOGO_BYTES = 500 * 1024;

export interface BrandSettingsValues {
  brand_name: string | null;
  brand_color: string | null;
  ai_language_style: string | null;
}

export type BrandSettingsParse = { ok: true; values: BrandSettingsValues } | { ok: false; error: string };

function blankToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : null;
}

/** Lo que manda la pantalla, validado igual que los CHECK de la 00266 (asi el error es claro, no uno de Postgres). */
export function parseBrandSettings(input: { name?: unknown; color?: unknown; languageStyle?: unknown }): BrandSettingsParse {
  const name = blankToNull(input.name);
  if (name && name.length > BRAND_NAME_MAX) return { ok: false, error: `El nombre puede tener hasta ${BRAND_NAME_MAX} caracteres` };

  const rawColor = blankToNull(input.color);
  const color = rawColor ? safeBrandColor(rawColor) : null;
  if (rawColor && !color) return { ok: false, error: "El color tiene que ser un código como #1a73e8" };

  const style = blankToNull(input.languageStyle);
  if (style && style.length > LANGUAGE_STYLE_MAX) return { ok: false, error: `El tono puede tener hasta ${LANGUAGE_STYLE_MAX} caracteres` };

  return { ok: true, values: { brand_name: name, brand_color: color?.toLowerCase() ?? null, ai_language_style: style } };
}

const DATA_URL = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/]+={0,2})$/;

export type BrandLogoUpload =
  | { ok: true; bytes: Uint8Array; ext: "png" | "jpg" | "webp"; mime: "image/png" | "image/jpeg" | "image/webp" }
  | { ok: false; error: string };

const LOGO_MIMES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

/**
 * El logo que sube la pantalla (data URL). El tipo sale de los BYTES, nunca de
 * lo que dice el navegador. SVG no: puede llevar codigo, y el logo va en
 * paginas publicas y en emails.
 */
export function parseBrandLogo(dataUrl: unknown): BrandLogoUpload {
  if (typeof dataUrl !== "string") return { ok: false, error: "No llegó ninguna imagen" };
  const match = DATA_URL.exec(dataUrl.trim());
  if (!match) return { ok: false, error: "El logo tiene que ser una imagen PNG, JPG o WEBP" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(match[1], "base64"));
  } catch {
    return { ok: false, error: "La imagen no se pudo leer" };
  }
  if (bytes.byteLength === 0) return { ok: false, error: "La imagen está vacía" };
  if (bytes.byteLength > MAX_LOGO_BYTES) return { ok: false, error: "El logo pesa más de 500 KB: probá con uno más chico" };
  const mime = sniffMime(bytes);
  if (mime && mime in LOGO_MIMES) {
    const m = mime as keyof typeof LOGO_MIMES;
    return { ok: true, bytes, ext: LOGO_MIMES[m], mime: m };
  }
  return { ok: false, error: "El logo tiene que ser una imagen PNG, JPG o WEBP" };
}

/**
 * Donde se guarda: una ruta NUEVA por cada logo (nunca se pisa uno), adentro de
 * la carpeta del workspace. Es lo que exige el CHECK `workspaces_brand_logo_path_check`.
 */
export function brandLogoPath(workspaceId: string, id: string, ext: "png" | "jpg" | "webp"): string {
  return `${workspaceId}/logo/${id}.${ext}`;
}

/** Si una ruta es un logo de ESE workspace (para no borrar nunca un archivo de otro). */
export function isOwnLogoPath(workspaceId: string, path: string | null | undefined): path is string {
  return typeof path === "string" && path.startsWith(`${workspaceId}/logo/`) && !path.includes("..");
}
