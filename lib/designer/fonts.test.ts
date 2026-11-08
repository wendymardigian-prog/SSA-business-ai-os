import { describe, expect, it } from "vitest";
import { CURATED_FONTS, checkFontUpload, fontGroups, googleCssUrl, googleFamilyCheckUrl, nearestWeight, sniffFont, uploadedFontFaces } from "./fonts";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(20).fill(0)]);
const ascii = (s: string) => bytes(...[...s].map((c) => c.charCodeAt(0)));

describe("tipografías (F11)", () => {
  it("son 60 familias curadas, sin repetir, con las que nombra el plano", () => {
    expect(CURATED_FONTS).toHaveLength(60);
    expect(new Set(CURATED_FONTS.map((f) => f.family)).size).toBe(60);
    for (const family of ["Inter", "Montserrat", "Poppins", "Space Grotesk", "DM Sans", "Manrope", "Bebas Neue", "Archivo Black", "Oswald", "Anton", "Playfair Display", "DM Serif Display", "Lora", "Fraunces", "Caveat", "Kalam", "JetBrains Mono"]) {
      expect(CURATED_FONTS.some((f) => f.family === family), family).toBe(true);
    }
  });

  it("googleCssUrl arma UNA sola URL con todas las familias y los pesos usados", () => {
    const url = googleCssUrl([
      { family: "Inter", weights: [700, 400] },
      { family: "Archivo Black", weights: [400] },
      { family: "Inter", weights: [400] },
    ]);
    expect(url).toBe("https://fonts.googleapis.com/css2?family=Archivo+Black:wght@400&family=Inter:wght@400;700&display=swap");
  });

  it("ajusta un peso que la familia no tiene al más cercano (Google devolvería 400 al pedido entero)", () => {
    expect(googleCssUrl([{ family: "Bebas Neue", weights: [700] }])).toContain("Bebas+Neue:wght@400");
    expect(nearestWeight([300, 400, 700], 600)).toBe(700);
  });

  it("una familia agregada (no curada) se pide sin pesos", () => {
    expect(googleCssUrl([{ family: "Comic Neue", weights: [700] }])).toContain("family=Comic+Neue&");
  });

  it("descarta nombres que no son de una familia y no pide nada si no hay", () => {
    expect(googleCssUrl([{ family: "x</style>", weights: [400] }])).toBeNull();
    expect(googleFamilyCheckUrl("Comic Neue")).toBe("https://fonts.googleapis.com/css2?family=Comic+Neue");
    expect(googleFamilyCheckUrl("a&b")).toBeNull();
  });

  it("reconoce una fuente por sus bytes", () => {
    expect(sniffFont(ascii("wOF2"))).toBe("woff2");
    expect(sniffFont(ascii("wOFF"))).toBe("woff");
    expect(sniffFont(ascii("OTTO"))).toBe("otf");
    expect(sniffFont(bytes(0, 1, 0, 0))).toBe("ttf");
  });

  it("una fuente subida que no es fuente por sus bytes se rechaza", () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47);
    expect(sniffFont(png)).toBeNull();
    expect(checkFontUpload(png)).toEqual({ ok: false, error: expect.stringMatching(/no es una fuente/) });
  });

  it("una fuente de más de 2 MB se rechaza", () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set([0x77, 0x4f, 0x46, 0x32]);
    expect(checkFontUpload(big).ok).toBe(false);
  });

  it("las subidas se cargan con @font-face y el link que da el servidor", () => {
    const css = uploadedFontFaces([{ family: "Mi Marca Sans", weight: 700, style: "normal", path: "ws/fonts/a.woff2", format: "woff2" }], (p) => `https://x/${p}`);
    expect(css).toBe('@font-face{font-family:"Mi Marca Sans";src:url("https://x/ws/fonts/a.woff2") format("woff2");font-weight:700;font-style:normal;font-display:swap}');
  });

  it("los grupos del desplegable: categorías, agregadas y subidas", () => {
    const groups = fontGroups({ google: ["Comic Neue", "Inter"], uploaded: [{ family: "Mi Marca Sans", weight: 400, style: "normal", path: "p", format: "ttf" }] });
    expect(groups.map((g) => g.label)).toEqual(["Sans", "Títulos", "Serif", "Manuscritas", "Monoespaciadas", "Agregadas de Google", "Subidas"]);
    expect(groups.at(-2)!.families).toEqual(["Comic Neue"]);
  });
});
