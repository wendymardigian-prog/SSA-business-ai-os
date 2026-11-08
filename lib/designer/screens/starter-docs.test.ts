import { describe, expect, it } from "vitest";
import { contrastRatio } from "../color";
import { parseDesignDoc } from "../doc/schema";
import { FORMATS, FORMAT_KEYS } from "../formats";
import { aiStartDoc, blankDoc, defaultName, imageDoc, newImageElement, newShapeElement, newTextElement, PLACEHOLDER_TEXT, readableTextColor, textSizes } from "./starter-docs";

const WS = "11111111-2222-3333-4444-555555555555";

describe("documentos de arranque (F30, F16)", () => {
  it("desde una imagen: la imagen es el fondo de la página 1, bloqueado y con ajuste «Cubrir»", () => {
    const doc = imageDoc("carta_h", `${WS}/images/base.png`, { brandColor: "#112233" });
    const bg = doc.pages[0].background;
    expect(bg.type).toBe("image");
    expect(bg.image).toEqual({ asset: `${WS}/images/base.png`, fit: "cover", focal: { x: 50, y: 50 }, locked: true });
    expect(doc.pages[0].elements).toEqual([]);
    expect(parseDesignDoc(doc).ok).toBe(true);
  });

  it("en blanco: el fondo es el color de la marca y hay un texto «Escribí acá» que se lee sobre él", () => {
    const doc = blankDoc("v45", { brandColor: "#0f1115" });
    expect(doc.pages[0].background).toMatchObject({ type: "color", color: "#0f1115" });
    const text = doc.pages[0].elements[0];
    expect(text).toMatchObject({ type: "text", text: PLACEHOLDER_TEXT });
    expect(contrastRatio((text as { color: string }).color, "#0f1115")).toBeGreaterThan(7);
  });

  it("sin color de marca el fondo es blanco y el texto, oscuro", () => {
    const doc = blankDoc("sq");
    expect(doc.pages[0].background).toMatchObject({ color: "#ffffff" });
    expect((doc.pages[0].elements[0] as { color: string }).color).toBe("#111111");
    expect(blankDoc("sq", { brandColor: "no-es-un-color" }).pages[0].background).toMatchObject({ color: "#ffffff" });
  });

  it("todos los formatos dan un documento válido, con ids únicos", () => {
    for (const format of FORMAT_KEYS) {
      for (const multiPage of [false, true]) {
        for (const doc of [blankDoc(format, { multiPage, brandColor: "#c4d94a" }), imageDoc(format, `${WS}/images/a.jpg`, { multiPage }), aiStartDoc(format, { style: "social" })]) {
          const parsed = parseDesignDoc(doc);
          expect(parsed.ok, `${format} ${multiPage}: ${JSON.stringify(parsed)}`).toBe(true);
        }
      }
    }
  });

  it("«Varias páginas» arranca con dos; una página web siempre tiene una (con su alto)", () => {
    expect(blankDoc("v45", { multiPage: true }).pages).toHaveLength(2);
    expect(blankDoc("v45", { multiPage: false }).pages).toHaveLength(1);
    const web = blankDoc("web", { multiPage: true });
    expect(web.pages).toHaveLength(1);
    expect(web.pages[0].height).toBe(FORMATS.web.height);
  });

  it("el estilo elegido queda en el documento", () => {
    expect(aiStartDoc("v45", { style: "editorial" }).style).toBe("editorial");
    expect(aiStartDoc("v45").style).toBeUndefined();
  });

  it("el texto se lee sobre cualquier fondo", () => {
    expect(readableTextColor("#ffffff")).toBe("#111111");
    expect(readableTextColor("#000000")).toBe("#ffffff");
    expect(readableTextColor("#c4d94a")).toBe("#111111");
    expect(readableTextColor(null)).toBe("#111111");
  });
});

describe("«Agregar» (F22): los elementos nuevos salen del formato", () => {
  it("el tamaño de letra depende del formato y el cuerpo nunca baja del mínimo", () => {
    for (const format of FORMAT_KEYS) {
      const sizes = textSizes(format);
      expect(sizes.title).toBeGreaterThan(sizes.subtitle);
      expect(sizes.subtitle).toBeGreaterThan(sizes.body);
      expect(sizes.body).toBeGreaterThanOrEqual(FORMATS[format].minFontSize);
    }
    expect(textSizes("story").title).toBeLessThan(textSizes("wide").title);
  });

  it("un texto nuevo nace centrado y válido", () => {
    const el = newTextElement("v45", "subtitle");
    expect(el).toMatchObject({ x: 50, y: 50, type: "text" });
    const doc = blankDoc("v45");
    doc.pages[0].elements.push(el);
    expect(parseDesignDoc(doc).ok).toBe(true);
  });

  it("una imagen y las formas nuevas son válidas, en el centro y con ids propios", () => {
    const doc = blankDoc("story");
    const image = newImageElement("story", `${WS}/images/x.png`);
    const rect = newShapeElement("story", "rect");
    const circle = newShapeElement("story", "circle", "#ff0000");
    const line = newShapeElement("story", "line");
    doc.pages[0].elements.push(image, rect, circle, line);
    expect(parseDesignDoc(doc).ok).toBe(true);
    expect(new Set(doc.pages[0].elements.map((e) => e.id)).size).toBe(5);
    expect(image.h).toBeLessThanOrEqual(100);
    expect(line.h).toBeUndefined();
  });

  it("los nombres por defecto", () => {
    expect(defaultName("design")).toBe("Diseño nuevo");
    expect(defaultName("template")).toBe("Plantilla nueva");
  });
});
