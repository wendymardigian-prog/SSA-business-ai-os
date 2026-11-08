import { describe, expect, it } from "vitest";
import { emptyDoc, parseDesignDoc, type DesignDoc } from "../doc/schema";
import { FORMATS } from "../formats";
import { convertDocFormat } from "./format-change";

function sample(format: DesignDoc["format"] = "sq"): DesignDoc {
  const doc = emptyDoc(format);
  doc.pages[0].elements = [
    { id: "el_t00001", type: "text", x: 50, y: 30, w: 80, text: "Hola", font: { family: "Inter", weight: 700 }, size: 100, letterSpacing: 4, align: "center", color: "#111111" },
    { id: "el_i00001", type: "image", x: 50, y: 60, w: 40, h: 40, asset: "ws/images/a.png", fit: "cover", radius: 20 },
    { id: "el_s00001", type: "shape", x: 20, y: 80, w: 20, h: 10, shape: "rect", fill: "#000000", stroke: { color: "#ffffff", width: 10 }, radius: 10 },
    { id: "el_h00001", type: "html", x: 50, y: 50, w: 100, h: 100, html: "<p>x</p>" },
  ];
  return doc;
}

describe("cambiar de formato (F17, F28)", () => {
  it("las posiciones y anchos (en %) se mantienen; las medidas en px se escalan con el ancho", () => {
    const out = convertDocFormat(sample("sq"), "wide");
    if (!out.ok) throw new Error(out.error);
    expect(out.doc.format).toBe("wide");
    const [text, image, shape] = out.doc.pages[0].elements;
    const ratio = FORMATS.wide.width / FORMATS.sq.width;
    expect(text).toMatchObject({ x: 50, y: 30, w: 80, size: Math.round(100 * ratio), letterSpacing: Math.round(4 * ratio * 100) / 100 });
    expect(image).toMatchObject({ x: 50, y: 60, w: 40, radius: Math.round(20 * ratio) });
    expect((shape as { stroke: { width: number } }).stroke.width).toBe(Math.round(10 * ratio * 100) / 100);
  });

  it("el alto de una imagen se ajusta a la proporción de la página para no deformarla", () => {
    const out = convertDocFormat(sample("sq"), "wide");
    if (!out.ok) throw new Error(out.error);
    const image = out.doc.pages[0].elements[1] as { w: number; h: number };
    // Cuadrada en 1080×1080 (40 % × 40 %) = 432 px de lado; en 1920×1080 son 768 px: 40 % de ancho × 71,11 % de alto.
    expect(image.h).toBeCloseTo(71.11, 1);
    expect((image.w / 100) * FORMATS.wide.width).toBeCloseTo(image.h * 0.01 * FORMATS.wide.height, 0);
  });

  it("el resultado sigue siendo un documento válido (el alto nunca pasa de 100 %)", () => {
    for (const to of ["carta_h", "story", "v45", "a4_v", "wide"] as const) {
      const out = convertDocFormat(sample("sq"), to);
      if (!out.ok) throw new Error(out.error);
      expect(parseDesignDoc(JSON.parse(JSON.stringify(out.doc))).ok, to).toBe(true);
    }
  });

  it("el mismo formato no cambia nada", () => {
    const doc = sample("sq");
    const out = convertDocFormat(doc, "sq");
    expect(out.ok && out.doc).toBe(doc);
  });

  it("una página web no se mezcla con los demás formatos", () => {
    expect(convertDocFormat(sample("web"), "sq")).toMatchObject({ ok: false });
    expect(convertDocFormat(sample("sq"), "web")).toMatchObject({ ok: false });
  });

  it("el tamaño de letra queda dentro de los límites", () => {
    const doc = sample("wide");
    (doc.pages[0].elements[0] as { size: number }).size = 5;
    const out = convertDocFormat(doc, "carta_v");
    if (!out.ok) throw new Error(out.error);
    expect((out.doc.pages[0].elements[0] as { size: number }).size).toBeGreaterThanOrEqual(4);
  });
});
