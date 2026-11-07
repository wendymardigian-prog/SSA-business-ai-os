import { describe, expect, it } from "vitest";
import type { DesignDoc } from "../doc/schema";
import { renderPageHTML } from "../render/page-html";
import { sanitizeAiDoc } from "./doc-sanitize";
import { runDesignerEngine, type EngineInput } from "./run";
import { carousel, WS } from "./test-fixtures";
import { CURATED_FONTS } from "../fonts";
import { findStyle, type DesignStyle } from "../styles";
import type { DesignerGenerate } from "./provider";

const htmlEl = (html: string) => ({ id: "el_html0001", type: "html" as const, x: 50, y: 50, w: 90, h: 90, html, css: ".a{color:red}" });

const withHtml = (html: string): DesignDoc => {
  const doc = carousel();
  doc.pages[0].elements.push(htmlEl(html));
  return doc;
};

describe("ai/doc-sanitize: todo documento de la IA pasa por la limpieza antes de guardarse", () => {
  it("un bloque HTML igual al que ya tenía el diseño se conserva", () => {
    const base = withHtml("<p>Cargado</p>");
    const r = sanitizeAiDoc(structuredClone(base), base);
    expect(r.removed).toBe(0);
    expect(r.doc.pages[0].elements.some((e) => e.type === "html")).toBe(true);
  });

  it("uno nuevo o cambiado (con un <script>) se saca", () => {
    const base = withHtml("<p>Cargado</p>");
    const tampered = withHtml("<p>Cargado</p><script>alert(1)</script>");
    const r = sanitizeAiDoc(tampered, base);
    expect(r.removed).toBe(1);
    expect(JSON.stringify(r.doc)).not.toContain("<script");

    const added = carousel();
    added.pages[1].elements.push({ ...htmlEl("<img src=x onerror=alert(1)>"), id: "el_html0002" });
    expect(sanitizeAiDoc(added, carousel()).removed).toBe(1);
  });
});

describe("ai/doc-sanitize: un parche de la IA que mete <script> no llega a guardarse", () => {
  const social = findStyle("social") as DesignStyle;
  const base = (doc: DesignDoc): EngineInput => ({
    mode: "change",
    workspaceId: WS,
    format: "v45",
    isTemplate: false,
    style: social,
    brand: { name: "Academia Ejemplo", colorHex: null },
    languageStyle: "español",
    allowedFonts: CURATED_FONTS.map((f) => f.family),
    doc,
    request: "Agregá un bloque",
    scope: { page: null },
    attachments: [],
    fallbackBackground: "#111111",
  });
  const gen = (...responses: unknown[]): DesignerGenerate => {
    let n = 0;
    return async <T,>() => ({ object: responses[Math.min(n++, responses.length - 1)] as T });
  };

  it("agregar un elemento html con script: el esquema lo rechaza y no queda nada", async () => {
    const evil = { message: "Listo", patch: { pages: [{ index: 0, ops: [{ op: "add", element: { type: "html", x: 50, y: 50, w: 50, html: "<script>alert(1)</script>" } }] }] } };
    const out = await runDesignerEngine(base(carousel()), { generate: gen(evil), measure: null });
    expect(out.ok).toBe(false);
  });

  it("cambiar el html de un bloque cargado: se rechaza", async () => {
    const doc = withHtml("<p>Cargado</p>");
    const evil = { message: "Listo", patch: { pages: [{ index: 0, ops: [{ op: "update", id: "el_html0001", set: { html: "<script>alert(1)</script>" } }] }] } };
    const out = await runDesignerEngine(base(doc), { generate: gen(evil), measure: null });
    expect(out.ok).toBe(false);
  });

  it("un texto con <script> se guarda como texto y el render lo escapa: nunca sale un <script>", async () => {
    const evil = { message: "Listo", patch: { pages: [{ index: 0, ops: [{ op: "update", id: "el_title01", set: { text: "<script>alert(1)</script> Hola" } }] }] } };
    const out = await runDesignerEngine(base(carousel()), { generate: gen(evil), measure: null });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const html = renderPageHTML(out.doc, 0, { mode: "export", assetUrl: () => "" });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;");
    expect(out.doc.pages.every((p) => p.elements.every((e) => e.type !== "html"))).toBe(true);
  });
});
