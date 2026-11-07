import { describe, expect, it } from "vitest";
import { emptyDoc, type DesignDoc } from "../doc/schema";
import { firstPageDoc, pageDesignHeight, thumbHtml, thumbSize } from "./thumbs";

const withText = (format: DesignDoc["format"] = "v45"): DesignDoc => {
  const doc = emptyDoc(format);
  doc.pages[0].elements.push({
    id: "el_aaaaaa",
    type: "text",
    x: 50,
    y: 50,
    w: 80,
    text: "Hola {{contact.first_name}}",
    font: { family: "Inter", weight: 700 },
    size: 60,
    align: "center",
    color: "#111111",
  });
  return doc;
};

describe("miniaturas en vivo (F48)", () => {
  it("la escala entra en la caja sin recortar la página", () => {
    const size = thumbSize(emptyDoc("story"), 0, { width: 190, height: 140 });
    expect(size.designWidth).toBe(1080);
    expect(size.designHeight).toBe(1920);
    expect(size.height).toBeLessThanOrEqual(140);
    expect(size.width).toBeLessThanOrEqual(190);
    expect(size.scale).toBeCloseTo(140 / 1920, 3);
  });

  it("un horizontal se escala por el ancho", () => {
    const size = thumbSize(emptyDoc("carta_h"), 0, { width: 190, height: 190 });
    expect(size.scale).toBeCloseTo(190 / 1056, 3);
    expect(size.width).toBe(190);
  });

  it("una página web se escala por el ancho y se recorta abajo (se ve su parte de arriba)", () => {
    const doc = emptyDoc("web");
    doc.pages[0].height = 6000;
    const size = thumbSize(doc, 0, { width: 190, height: 140 });
    expect(size.designHeight).toBe(6000);
    expect(size.width).toBe(190);
    expect(size.height).toBe(140);
    expect(pageDesignHeight(doc, 0)).toBe(6000);
  });

  it("el HTML sale de renderPageHTML: con la variable como chip y nunca con <script", () => {
    const html = thumbHtml({ doc: withText() });
    expect(html).toContain("dz-var");
    expect(html).toContain("Nombre");
    expect(html).not.toMatch(/<script/i);
  });

  it("firma las imágenes con las URLs que recibe y deja vacía la que no tiene", () => {
    const doc = withText();
    doc.pages[0].background = { type: "image", image: { asset: "ws/images/a.png", fit: "cover", focal: { x: 50, y: 50 }, locked: true } };
    expect(thumbHtml({ doc, assetUrls: { "ws/images/a.png": "https://s.test/a.png" } })).toContain("https://s.test/a.png");
    expect(thumbHtml({ doc })).not.toContain("ws/images/a.png");
  });

  it("firstPageDoc se queda con la página 1", () => {
    const doc = withText();
    doc.pages.push({ ...doc.pages[0], id: "pg_bbbbbb" });
    expect(firstPageDoc(doc).pages).toHaveLength(1);
  });
});
