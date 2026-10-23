import { describe, expect, it } from "vitest";
import { defaultStickerTab, isAnimatedWebp, isStickerLibraryPath, isWebp, stickerLibraryPath, stickersForTab, type StickerItem } from "./format";

function webp(chunk: string, flags = 0): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  bytes.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
  bytes.set([...chunk].map((c) => c.charCodeAt(0)), 12);
  bytes[20] = flags;
  return bytes;
}

describe("isWebp / isAnimatedWebp", () => {
  it("reconoce un webp y si es animado por el bit de VP8X", () => {
    expect(isWebp(webp("VP8 "))).toBe(true);
    expect(isAnimatedWebp(webp("VP8 "))).toBe(false);
    expect(isAnimatedWebp(webp("VP8X", 0x02))).toBe(true);
    expect(isAnimatedWebp(webp("VP8X", 0x10))).toBe(false);
  });

  it("un chunk ANIM también cuenta", () => {
    const bytes = webp("VP8X");
    bytes.set([..."ANIM"].map((c) => c.charCodeAt(0)), 30);
    expect(isAnimatedWebp(bytes)).toBe(true);
  });

  it("un PNG no es webp", () => {
    expect(isWebp(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });
});

describe("rutas de la biblioteca", () => {
  const ws = "11111111-1111-1111-1111-111111111111";
  const sha = "a".repeat(64);

  it("una por contenido, dentro del workspace", () => {
    expect(stickerLibraryPath(ws, sha)).toBe(`${ws}/stickers/${sha}.webp`);
    expect(isStickerLibraryPath(stickerLibraryPath(ws, sha), ws)).toBe(true);
    expect(isStickerLibraryPath(stickerLibraryPath(ws, sha), "22222222-2222-2222-2222-222222222222")).toBe(false);
    expect(isStickerLibraryPath(`${ws}/stickers/../x.webp`, ws)).toBe(false);
  });
});

describe("stickersForTab", () => {
  const s = (id: string, extra: Partial<StickerItem>): StickerItem => ({
    id,
    storagePath: id,
    isAnimated: false,
    isFavorite: false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    ...extra,
  });
  const items = [
    s("a", { isFavorite: true, lastUsedAt: "2026-10-02T00:00:00Z" }),
    s("b", { lastUsedAt: "2026-10-05T00:00:00Z" }),
    s("c", { createdAt: "2026-10-09T00:00:00Z" }),
  ];

  it("favoritos, recientes (por último uso) y todos (los nuevos primero)", () => {
    expect(stickersForTab(items, "favorites").map((x) => x.id)).toEqual(["a"]);
    expect(stickersForTab(items, "recent").map((x) => x.id)).toEqual(["b", "a"]);
    expect(stickersForTab(items, "all").map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("abre en favoritos si hay; si no, recientes; si no, todos", () => {
    expect(defaultStickerTab(items)).toBe("favorites");
    expect(defaultStickerTab([items[1]])).toBe("recent");
    expect(defaultStickerTab([items[2]])).toBe("all");
  });
});
