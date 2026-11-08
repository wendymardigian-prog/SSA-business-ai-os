import { describe, expect, it } from "vitest";
import { CURATED_FONTS } from "../fonts";
import { FORMAT_KEYS } from "../formats";
import { styleSchema } from "../styles";
import type { DesignerGenerate, DesignerGenerateArgs } from "./provider";
import { densityByFormat, EXTRACT_SYSTEM, extractStyleFromImages, newStyleKey, normalizeExtractedStyle, sanitizeDensity, type ExtractedStyle } from "./style-extract";
import { PNG_BYTES } from "./test-db";

const allowedFonts = CURATED_FONTS.map((f) => f.family);

const extracted = (over: Partial<ExtractedStyle> = {}): ExtractedStyle => ({
  name: "Mi estilo",
  palette: { bg: "#101820", text: "#fef9ef", accent: "#f2aa4c" },
  fonts: { title: "Archivo Black", body: "Inter" },
  density: { social: 22, story: 16, slides: 36, print: 110, web: 350 },
  rules: "Fondo oscuro, títulos enormes en mayúsculas y un solo acento cálido por pieza.",
  ...over,
});

const images = (n: number) => Array.from({ length: n }, (_, i) => ({ bytes: PNG_BYTES, mediaType: "image/png", name: `pieza-${i + 1}.png` }));

function provider(responses: unknown[]) {
  const calls: DesignerGenerateArgs<unknown>[] = [];
  const generate: DesignerGenerate = async <T,>(args: DesignerGenerateArgs<T>) => {
    calls.push(args as DesignerGenerateArgs<unknown>);
    return { object: responses[Math.min(calls.length - 1, responses.length - 1)] as T, usage: { inputTokens: 500, outputTokens: 120 } };
  };
  return { generate, calls };
}

describe("ai/style-extract: normalizar lo que extrajo la IA (F37)", () => {
  it("el estilo extraído valida contra el esquema de estilos y arranca con clave propia", () => {
    const r = normalizeExtractedStyle(extracted(), { allowedFonts });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(styleSchema.safeParse(r.style).success).toBe(true);
    expect(r.style.key).toMatch(/^c_[a-z0-9]{6}$/);
    expect(r.style.name).toBe("Mi estilo");
    expect(r.style.palette).toEqual({ bg: "#101820", text: "#fef9ef", accent: "#f2aa4c" });
    expect(r.corrections).toEqual([]);
  });

  it("uno con una fuente fuera de la lista se corrige a la más cercana, y se avisa", () => {
    const r = normalizeExtractedStyle(extracted({ fonts: { title: "Playfair", body: "Montserat" } }), { allowedFonts });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.style.fonts).toEqual({ title: "Playfair Display", body: "Montserrat" });
    expect(r.corrections).toHaveLength(2);
    expect(r.corrections[0]).toMatch(/«Playfair» no está en la lista: usé «Playfair Display»/);
  });

  it("una fuente de Google agregada por el negocio cuenta como permitida", () => {
    const r = normalizeExtractedStyle(extracted({ fonts: { title: "Rubik Mono One", body: "Inter" } }), { allowedFonts: [...allowedFonts, "Rubik Mono One"] });
    expect(r.ok && r.style.fonts.title).toBe("Rubik Mono One");
  });

  it("un color mal escrito cae al del estilo Automático; uno sin # se arregla", () => {
    const r = normalizeExtractedStyle(extracted({ palette: { bg: "rojo", text: "FFFFFF", accent: "#abc" } }), { allowedFonts });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.style.palette.bg).toBe("#ffffff");
      expect(r.style.palette.text).toBe("#ffffff");
      expect(r.style.palette.accent).toBe("#4f46e5");
    }
  });

  it("la densidad se reparte por formato y se acota", () => {
    const d = densityByFormat({ social: 22, story: 16, slides: 36, print: 110, web: 350 });
    expect(d).toMatchObject({ sq: 22, v45: 22, story: 16, wide: 36, carta_v: 110, carta_h: 110, a4_v: 110, a4_h: 110, web: 350 });
    expect(Object.keys(d).sort()).toEqual([...FORMAT_KEYS].sort());
    expect(densityByFormat({ social: 9999, story: -4 }).sq).toBe(200);
    expect(densityByFormat({ story: -4 }).story).toBe(5);
    expect(sanitizeDensity({ sq: 30.4, story: 99999 as number, v45: Number.NaN })).toEqual({ sq: 30, story: 1000 });
  });

  it("el nombre que escribió la persona gana, y sin nombre es «Mi estilo»", () => {
    expect(normalizeExtractedStyle(extracted({ name: undefined }), { allowedFonts }).ok && normalizeExtractedStyle(extracted({ name: undefined }), { allowedFonts })).toMatchObject({ style: { name: "Mi estilo" } });
    const named = normalizeExtractedStyle(extracted(), { allowedFonts, name: "  Estilo del programa  " });
    expect(named.ok && named.style.name).toBe("Estilo del programa");
  });

  it("conserva la clave propia al editar y la cambia si no es de un estilo propio (c_…)", () => {
    expect(normalizeExtractedStyle(extracted(), { allowedFonts, key: "c_abc123" }).ok && normalizeExtractedStyle(extracted(), { allowedFonts, key: "c_abc123" })).toMatchObject({ style: { key: "c_abc123" } });
    const fromFactory = normalizeExtractedStyle(extracted(), { allowedFonts, key: "social" });
    expect(fromFactory.ok && fromFactory.style.key).toMatch(/^c_/);
    expect(newStyleKey()).toMatch(/^c_[a-z0-9]{6}$/);
  });

  it("las reglas se recortan al límite", () => {
    const r = normalizeExtractedStyle(extracted({ rules: "x".repeat(3000) }), { allowedFonts, rulesLimit: 2000 });
    expect(r.ok && r.style.rules.length).toBe(2000);
  });
});

describe("ai/style-extract: pedirle el estilo a la IA (proveedor simulado)", () => {
  it("manda las imágenes, y los nombres de archivo solo como dato", async () => {
    const p = provider([extracted()]);
    const r = await extractStyleFromImages({ images: images(3), allowedFonts }, { generate: p.generate, nonce: () => "n0nce" });
    expect(r.ok).toBe(true);
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].images).toHaveLength(3);
    expect(p.calls[0].system).toBe(EXTRACT_SYSTEM);
    expect(p.calls[0].system).not.toContain("pieza-1.png");
    expect(p.calls[0].text).toContain("<<<imagenes n0nce>>>");
    expect(p.calls[0].text).toContain("Imagen 1: pieza-1.png");
  });

  it("pide entre 3 y 5 piezas", async () => {
    const p = provider([extracted()]);
    expect(await extractStyleFromImages({ images: images(2), allowedFonts }, { generate: p.generate })).toEqual({ ok: false, error: "Elegí entre 3 y 5 piezas." });
    expect((await extractStyleFromImages({ images: images(6), allowedFonts }, { generate: p.generate })).ok).toBe(false);
    expect(p.calls).toHaveLength(0);
    expect((await extractStyleFromImages({ images: images(5), allowedFonts }, { generate: p.generate })).ok).toBe(true);
  });

  it("una respuesta inválida se reintenta una vez; si vuelve a fallar, avisa sin inventar un estilo", async () => {
    const bad = { palette: { bg: "#000000" } };
    const retry = provider([bad, extracted()]);
    expect((await extractStyleFromImages({ images: images(3), allowedFonts }, { generate: retry.generate })).ok).toBe(true);
    expect(retry.calls).toHaveLength(2);
    expect(retry.calls[1].text).toMatch(/respuesta anterior no era válida/);

    const always = provider([bad]);
    const r = await extractStyleFromImages({ images: images(3), allowedFonts }, { generate: always.generate });
    expect(r).toEqual({ ok: false, error: "No pude armar un estilo con esas piezas. Probá con otras imágenes." });
    expect(always.calls).toHaveLength(2);
  });

  it("suma el uso de cada llamada para el costo", async () => {
    const usages: unknown[] = [];
    await extractStyleFromImages({ images: images(3), allowedFonts }, { generate: provider([extracted()]).generate, onUsage: (u) => usages.push(u) });
    expect(usages).toEqual([{ inputTokens: 500, outputTokens: 120 }]);
  });

  it("corrige la fuente fuera de la lista en lo que devuelve el modelo", async () => {
    const r = await extractStyleFromImages({ images: images(4), allowedFonts }, { generate: provider([extracted({ fonts: { title: "Bebas", body: "Poppin" } })]).generate });
    expect(r.ok && r.style.fonts).toEqual({ title: "Bebas Neue", body: "Poppins" });
    expect(r.ok && r.corrections).toHaveLength(2);
  });
});
