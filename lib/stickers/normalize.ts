/**
 * Lleva una imagen subida a la forma de un sticker de WhatsApp: webp de
 * 512 x 512, fondo transparente (`contain`, sin recortar), animado si viene de
 * un GIF o de un webp animado. Asi lo que se ve en la biblioteca es lo que
 * recibe el lead (Evolution solo lo vuelve a pasar por sharp, sin cambiarlo).
 *
 * Solo de servidor (sharp es nativo). El tipo se decide por los bytes.
 */

import sharp from "sharp";
import { sniffMime } from "@/lib/content/media";
import {
  ANIMATED_STICKER_MAX_BYTES,
  MAX_STICKER_INPUT_BYTES,
  STATIC_STICKER_MAX_BYTES,
  STICKER_INPUT_MIMES,
  STICKER_SIZE,
  STICKER_TOO_LARGE_INPUT,
  STICKER_UNSUPPORTED,
} from "./format";

export type NormalizedSticker = { ok: true; bytes: Buffer; animated: boolean } | { ok: false; error: string };

const QUALITIES = [80, 60, 40, 25];

export async function normalizeSticker(input: Uint8Array): Promise<NormalizedSticker> {
  if (input.byteLength > MAX_STICKER_INPUT_BYTES) return { ok: false, error: STICKER_TOO_LARGE_INPUT };
  const mime = sniffMime(input);
  if (!mime || !(STICKER_INPUT_MIMES as readonly string[]).includes(mime)) return { ok: false, error: STICKER_UNSUPPORTED };

  try {
    const animatedInput = mime === "image/gif" || mime === "image/webp";
    const meta = await sharp(input, { animated: animatedInput }).metadata();
    const animated = animatedInput && (meta.pages ?? 1) > 1;
    const limit = animated ? ANIMATED_STICKER_MAX_BYTES : STATIC_STICKER_MAX_BYTES;

    for (const quality of QUALITIES) {
      const bytes = await sharp(input, { animated })
        .resize(STICKER_SIZE, STICKER_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality, loop: 0, effort: 4 })
        .toBuffer();
      if (bytes.byteLength <= limit) return { ok: true, bytes, animated };
    }
    return {
      ok: false,
      error: animated
        ? "El sticker animado queda muy pesado para WhatsApp (más de 500 KB). Probá con un GIF más corto."
        : "El sticker queda muy pesado para WhatsApp (más de 100 KB). Probá con una imagen más simple.",
    };
  } catch (err) {
    console.error("[stickers] no pude convertir la imagen:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "No pude leer esa imagen. Probá con otra." };
  }
}
