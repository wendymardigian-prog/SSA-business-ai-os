import { describe, expect, it } from "vitest";
import { parseDesignDoc } from "../doc/schema";
import { CURATED_FONTS } from "../fonts";
import { AssetAliases } from "./assets";
import { closestFontFamily, normalizeDoc } from "./normalize";
import { WS } from "./test-fixtures";

const allowed = CURATED_FONTS.map((f) => f.family);
const own = `${WS}/images/aaaaaaaa-0000-0000-0000-000000000001.png`;
const ctx = (assets = new AssetAliases(WS, [own])) => ({ format: "v45" as const, allowedFonts: allowed, assets, fallbackBackground: "#111111", styleKey: "social" });

const doc = (pages: unknown[]) => ({ pages });
const text = { type: "text", x: 50, y: 50, w: 80, text: "Hola", font: { family: "Inter", weight: 700 }, size: 60, align: "center", color: "#ffffff" };

describe("ai/normalize: fuentes", () => {
  it("una fuente fuera de la lista se corrige a la más cercana", () => {
    expect(closestFontFamily("Montserat", allowed)).toBe("Montserrat");
    expect(closestFontFamily("playfair", allowed)).toBe("Playfair Display");
    expect(closestFontFamily("space grotesque", allowed)).toBe("Space Grotesk");
    expect(closestFontFamily("Archivo  Black", allowed)).toBe("Archivo Black");
  });

  it("devuelve siempre una de las permitidas", () => {
    expect(allowed).toContain(closestFontFamily("zzzzzz", allowed));
  });

  it("normalizeDoc corrige la familia y ajusta el peso al disponible", () => {
    const { doc: out } = normalizeDoc(doc([{ background: { type: "color", color: "#000000" }, elements: [{ ...text, font: { family: "Poppin", weight: 750 } }] }]), ctx());
    const parsed = parseDesignDoc(out);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const el = parsed.doc.pages[0].elements[0];
      expect(el.type === "text" && el.font.family).toBe("Poppins");
      expect(el.type === "text" && el.font.weight % 100).toBe(0);
    }
  });
});

describe("ai/normalize: ids, rangos e imágenes", () => {
  it("asigna ids a páginas y elementos, y arregla los repetidos", () => {
    const { doc: out } = normalizeDoc(
      doc([
        { background: { type: "color", color: "#000000" }, elements: [text, { ...text, id: "el_dup00001" }, { ...text, id: "el_dup00001" }] },
        { id: "pg_malo!", background: { type: "color", color: "#000000" }, elements: [] },
      ]),
      ctx(),
    );
    const parsed = parseDesignDoc(out);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const ids = parsed.doc.pages.flatMap((p) => p.elements.map((e) => e.id));
      expect(new Set(ids).size).toBe(3);
    }
  });

  it("recorta porcentajes y la capa de color, y los textos no llevan alto", () => {
    const { doc: out } = normalizeDoc(
      doc([{ background: { type: "color", color: "#000000" }, elements: [{ ...text, x: 140, y: -5, w: 300, h: 20, opacity: 4 }] }]),
      ctx(),
    );
    const parsed = parseDesignDoc(out);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const el = parsed.doc.pages[0].elements[0];
      expect(el.x).toBe(100);
      expect(el.y).toBe(0);
      expect(el.w).toBe(100);
      expect(el.h).toBeUndefined();
      expect(el.opacity).toBe(1);
    }
  });

  it("traduce el nombre corto de una imagen adjunta a su ruta real", () => {
    const { doc: out } = normalizeDoc(
      doc([{ background: { type: "image", image: { asset: "imagen_1", fit: "cover", focal: { x: 50, y: 50 }, locked: false }, overlay: { color: "#000000", opacity: 2 } }, elements: [] }]),
      ctx(),
    );
    const parsed = parseDesignDoc(out);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.pages[0].background.image?.asset).toBe(own);
      expect(parsed.doc.pages[0].background.overlay?.opacity).toBe(0.9);
    }
  });

  it("una imagen que no existe se saca (elemento) o cae a un color liso (fondo), y avisa", () => {
    const { doc: out, warnings } = normalizeDoc(
      doc([
        {
          background: { type: "image", image: { asset: "otra/ruta/de/otro.png", fit: "cover", focal: { x: 50, y: 50 }, locked: false } },
          elements: [{ type: "image", x: 50, y: 50, w: 50, h: 50, asset: "imagen_9", fit: "cover" }, text],
        },
      ]),
      ctx(),
    );
    const parsed = parseDesignDoc(out);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.pages[0].background).toEqual({ type: "color", color: "#111111" });
      expect(parsed.doc.pages[0].elements).toHaveLength(1);
    }
    expect(warnings.length).toBe(2);
  });

  it("una ruta del propio negocio copiada tal cual se acepta; una de otro negocio, no", () => {
    const aliases = new AssetAliases(WS);
    expect(aliases.resolve(own)).toBe(own);
    expect(aliases.resolve("99999999-0000-0000-0000-000000000000/images/x.png")).toBeNull();
    expect(aliases.resolve(`${WS}/../x.png`)).toBeNull();
  });

  it("fija el formato y el estilo del documento, y el alto solo existe en una página web", () => {
    const { doc: out } = normalizeDoc({ v: 1, format: "web", pages: [{ height: 3000, background: { type: "color", color: "#000000" }, elements: [] }] }, ctx());
    const parsed = parseDesignDoc(out);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.format).toBe("v45");
      expect(parsed.doc.style).toBe("social");
      expect(parsed.doc.pages[0].height).toBeUndefined();
    }
  });

  it("las imágenes tienen nombres cortos en el mismo orden: primero las adjuntas", () => {
    const aliases = new AssetAliases(WS, [own]);
    expect(aliases.aliasFor(own)).toBe("imagen_1");
    expect(aliases.entries()).toEqual([{ alias: "imagen_1", path: own }]);
  });
});
