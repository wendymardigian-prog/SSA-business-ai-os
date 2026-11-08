import { describe, expect, it } from "vitest";
import { emptyDoc, type DesignDoc, type DesignElement } from "../doc/schema";
import { renderPageHTML } from "../render/page-html";
import { declaredMinWidth, DEVICES, hasHorizontalOverflow, mobilePreviewHtml, overflowReport, WEB_BREAKPOINT_PX } from "./web";

const assetUrl = (p: string) => `https://s.test/${p}`;

function webDoc(extra: DesignElement[] = []): DesignDoc {
  const doc = emptyDoc("web", "#ffffff");
  doc.pages[0].height = 3000;
  doc.pages[0].elements = [
    { id: "el_t00001", type: "text", x: 50, y: 6, w: 80, text: "Clase gratuita", font: { family: "Inter", weight: 800 }, size: 72, align: "center", color: "#111111" },
    { id: "el_i00001", type: "image", x: 50, y: 20, w: 60, h: 14, asset: "ws/images/a.png", fit: "cover" },
    { id: "el_s00001", type: "shape", x: 50, y: 40, w: 30, h: 4, shape: "rect", fill: "#4f46e5" },
    ...extra,
  ];
  return doc;
}

const html = (id: string, markup: string, css?: string): DesignElement => ({ id, type: "html", x: 50, y: 70, w: 100, h: 40, html: markup, css });

describe("página web (F29)", () => {
  it("el render público de la muestra a 390 px no tiene desplazamiento horizontal", () => {
    const doc = webDoc([html("el_h00001", '<section class="hero"><h1 data-tx="t1">Título</h1><div class="cols"><div>Uno</div><div>Dos</div></div></section>', ".hero{padding:40px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}")]);
    expect(hasHorizontalOverflow(doc, 390, assetUrl)).toBe(false);
    const report = overflowReport(mobilePreviewHtml(doc, assetUrl), 390);
    expect(report.overflows).toBe(false);
    expect(report.widest).toBe(0);
    expect(DEVICES.mobile.width).toBe(390);
    expect(DEVICES.desktop.width).toBe(1280);
    expect(WEB_BREAKPOINT_PX).toBe(640);
  });

  it("detecta un ancho fijo que se pasa de la pantalla (en un bloque de HTML)", () => {
    const doc = webDoc([html("el_h00001", '<div style="width: 1200px">ancho</div>')]);
    const report = overflowReport(mobilePreviewHtml(doc, assetUrl), 390);
    expect(report.overflows).toBe(true);
    expect(report.widest).toBe(1200);
    expect(report.offenders).toEqual([{ tag: "div", property: "width", width: 1200 }]);
    // En una pantalla de escritorio ese mismo bloque cabe.
    expect(overflowReport(mobilePreviewHtml(doc, assetUrl), 1280).overflows).toBe(false);
    expect(hasHorizontalOverflow(doc, 390, assetUrl)).toBe(true);
  });

  it("lee los anchos mínimos de las reglas de <style> y respeta las de @media que aplican a ese ancho", () => {
    const fixed = webDoc([html("el_h00001", '<div class="hero">x</div>', ".hero{min-width:900px}")]);
    expect(declaredMinWidth(mobilePreviewHtml(fixed, assetUrl), 390)).toBe(900);
    const adapted = webDoc([html("el_h00001", '<div class="hero">x</div>', ".hero{min-width:900px} @media (max-width: 640px){.hero{min-width:0}}")]);
    expect(declaredMinWidth(mobilePreviewHtml(adapted, assetUrl), 390)).toBe(0);
    // A 1280 la regla de @media no aplica y vale la de 900.
    expect(declaredMinWidth(mobilePreviewHtml(adapted, assetUrl), 1280)).toBe(900);
  });

  it("un !important de una regla le gana al estilo en línea", () => {
    const css = "@media (max-width: 640px){.fijo{width:100%!important}}";
    const doc = webDoc([html("el_h00001", '<div class="fijo" style="width: 1000px">x</div>', css)]);
    expect(declaredMinWidth(mobilePreviewHtml(doc, assetUrl), 390)).toBe(0);
    // Sin el !important, el estilo en línea gana.
    const weak = webDoc([html("el_h00001", '<div class="fijo" style="width: 1000px">x</div>', "@media (max-width: 640px){.fijo{width:100%}}")]);
    expect(declaredMinWidth(mobilePreviewHtml(weak, assetUrl), 390)).toBe(1000);
  });

  it("lo que está en %, vw, auto o calc() se adapta y no cuenta", () => {
    const doc = webDoc([html("el_h00001", '<div style="width: 100%">a</div><div style="width:auto">b</div><div style="width: calc(100% - 20px)">c</div><div style="width: 90vw">d</div><div style="max-width: 1200px">e</div>')]);
    expect(overflowReport(mobilePreviewHtml(doc, assetUrl), 390).widest).toBe(0);
  });

  it("las páginas que NO son web sí se pasan de una pantalla de 390 px (por eso la web es responsive)", () => {
    const post = emptyDoc("v45");
    const exported = renderPageHTML(post, 0, { mode: "export", assetUrl });
    expect(overflowReport(exported, 390).overflows).toBe(true);
    expect(overflowReport(exported, 390).widest).toBe(1080);
  });

  it("el render público de una web usa un ancho relativo y el punto de quiebre a 640 px", () => {
    const out = mobilePreviewHtml(webDoc(), assetUrl);
    expect(out).toContain("max-width: 1280px");
    expect(out).toContain("@media (max-width: 640px)");
    expect(out).not.toMatch(/<script/i);
  });

  it("los selectores con combinadores no se evalúan (no inventan anchos)", () => {
    const css = ".a .b{width:5000px} .c > .d{width:5000px}";
    const doc = webDoc([html("el_h00001", '<div class="a"><div class="b">x</div></div>', css)]);
    expect(declaredMinWidth(mobilePreviewHtml(doc, assetUrl), 390)).toBe(0);
  });
});
