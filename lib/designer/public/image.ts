/**
 * Las imágenes de una pieza en el link público (F43): la PNG de cada página, a ×1 o ×2, y la que va en la
 * tarjeta al compartir. Solo servidor (usa `sharp`).
 *
 * El juego de archivos de un diseño se renderiza UNA vez: los impresos salen ×1 y las redes y presentaciones ×2
 * (F46). Para `srcset="… 1x, … 2x"` de verdad, la variante ×1 de una pieza que se guardó ×2 se achica al ancho de
 * diseño; la ×2 de una pieza guardada ×1 es la misma (no se agranda: no hay más detalle que mostrar).
 */

import sharp from "sharp";
import { FORMATS, type FormatKey } from "../formats";

export type ImageVariant = 1 | 2;

/** `?x=1` o `?x=2`; sin nada (o algo raro), la ×2: el archivo tal cual se guardó. */
export function parseVariant(raw: string | null | undefined): ImageVariant {
  return raw === "1" ? 1 : 2;
}

/** Si hay que achicar el archivo guardado para entregar esta variante. */
export function needsDownscale(format: FormatKey, variant: ImageVariant): boolean {
  return variant === 1 && FORMATS[format].exportScale === 2;
}

/** Achica un PNG a `width` px de ancho (nunca lo agranda). Un archivo que no se puede leer se devuelve como está. */
export async function downscalePng(bytes: Uint8Array, width: number): Promise<Uint8Array> {
  try {
    const out = await sharp(bytes).resize({ width, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    return new Uint8Array(out);
  } catch (error) {
    console.error("[disenos] no pude achicar la imagen:", error instanceof Error ? error.message : "error");
    return bytes;
  }
}

/** El ancho de la imagen de la tarjeta: lo que lee bien WhatsApp (1200 px), sin pasar los 5 MB de las redes. */
export const SHARE_IMAGE_WIDTH = 1200;
