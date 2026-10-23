import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeSticker } from "./normalize";
import { isAnimatedWebp, isWebp, STATIC_STICKER_MAX_BYTES } from "./format";

async function png(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 90, alpha: 1 } } })
      .png()
      .toBuffer(),
  );
}

async function gif(frames: number): Promise<Uint8Array> {
  const colors = [
    { r: 0, g: 120, b: 255, alpha: 1 },
    { r: 255, g: 120, b: 0, alpha: 1 },
    { r: 0, g: 200, b: 80, alpha: 1 },
  ];
  const images = await Promise.all(
    Array.from({ length: frames }, (_, i) =>
      sharp({ create: { width: 64, height: 64, channels: 4, background: colors[i % colors.length] } }).png().toBuffer(),
    ),
  );
  return new Uint8Array(await sharp(images, { join: { animated: true } }).gif().toBuffer());
}

describe("normalizeSticker", () => {
  it("una imagen queda webp de 512 x 512, estática y liviana", async () => {
    const result = await normalizeSticker(await png(900, 300));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isWebp(result.bytes)).toBe(true);
    expect(result.animated).toBe(false);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(STATIC_STICKER_MAX_BYTES);
    const meta = await sharp(result.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
  });

  it("un GIF con varios cuadros queda como sticker animado", async () => {
    const result = await normalizeSticker(await gif(3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.animated).toBe(true);
    expect(isAnimatedWebp(result.bytes)).toBe(true);
  });

  it("rechaza lo que no es imagen, por los bytes", async () => {
    const result = await normalizeSticker(new TextEncoder().encode("%PDF-1.7 no soy una imagen"));
    expect(result).toEqual({ ok: false, error: "Usá una imagen PNG, JPG, WEBP o un GIF." });
  });
});
