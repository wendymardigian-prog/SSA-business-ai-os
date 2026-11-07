import { afterEach, describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { PLATE_DARK, PLATE_LIGHT, loadLogo, logoPlate, prepareLogo } from "./logo";

function pixels(...rgba: number[][]): Uint8Array {
  return Uint8Array.from(rgba.flat());
}

const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];
const CLEAR = [0, 0, 0, 0];

function square(background: { r: number; g: number; b: number; alpha: number }, format: "png" | "webp" = "png", size = 600) {
  return sharp({ create: { width: size, height: size, channels: 4, background } })[format]().toBuffer();
}

describe("logoPlate", () => {
  it("un logo claro con transparencia va sobre oscuro", () => {
    expect(logoPlate(pixels(WHITE, CLEAR))).toBe(PLATE_DARK);
  });
  it("un logo oscuro con transparencia va sobre claro", () => {
    expect(logoPlate(pixels(BLACK, CLEAR))).toBe(PLATE_LIGHT);
  });
  it("un logo opaco trae su propio fondo: va sobre claro aunque sea blanco", () => {
    expect(logoPlate(pixels(WHITE, WHITE))).toBe(PLATE_LIGHT);
  });
  it("uno completamente transparente no rompe", () => {
    expect(logoPlate(pixels(CLEAR))).toBe(PLATE_LIGHT);
  });
});

describe("prepareLogo", () => {
  it("convierte un webp a PNG y lo achica sin deformarlo", async () => {
    const logo = await prepareLogo(await square({ r: 10, g: 20, b: 30, alpha: 1 }, "webp"));
    expect(logo.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(logo).toMatchObject({ width: 150, height: 150, plate: PLATE_LIGHT });
  });
  it("mira la transparencia real del archivo", async () => {
    const half = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
      .composite([{ input: await square({ r: 255, g: 255, b: 255, alpha: 1 }, "png", 50), left: 0, top: 0 }])
      .png()
      .toBuffer();
    expect((await prepareLogo(half)).plate).toBe(PLATE_DARK);
  });
});

describe("loadLogo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sin URL no pide nada", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await loadLogo(null)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("un logo que no se puede bajar o leer da null, no un error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 404 })));
    expect(await loadLogo("https://x/logo.png")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("red")));
    expect(await loadLogo("https://x/logo.png")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("esto no es una imagen")));
    expect(await loadLogo("https://x/logo.png")).toBeNull();
  });
  it("un logo demasiado pesado da null", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(3 * 1024 * 1024))));
    expect(await loadLogo("https://x/logo.png")).toBeNull();
  });
});
