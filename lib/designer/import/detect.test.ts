import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectFromParts, detectHtmlFormat, estimateWebHeight, formatForRatio, nearestSlideFormat, splitSlides } from "./detect";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("detectHtmlFormat (F41): los seis archivos de muestra", () => {
  it("una landing con secciones sin tamaño fijo es una página web", () => {
    const d = detectHtmlFormat(fixture("landing-clase.html"));
    expect(d).toMatchObject({ as: "web", format: "web", pages: 1, label: "Página web · una sola página con scroll", sizePx: null });
  });

  it("otra landing, con un único contenedor .page, también es web", () => {
    expect(detectHtmlFormat(fixture("landing-servicios.html"))).toMatchObject({ as: "web", format: "web", pages: 1 });
  });

  it("una presentación 16:9 con diapositivas de 1920 × 1080 se detecta como wide con 5 páginas", () => {
    const d = detectHtmlFormat(fixture("presentacion-16-9-fija.html"));
    expect(d).toMatchObject({ as: "slides", format: "wide", pages: 5, sizePx: { w: 1920, h: 1080 } });
    expect(d.label).toBe("Presentación · 5 diapositivas de 1920 × 1080");
  });

  it("una presentación con @page 16:9 y las diapositivas dentro de un <main> se detecta como wide con 4 páginas", () => {
    const d = detectHtmlFormat(fixture("presentacion-16-9-pagina.html"));
    expect(d).toMatchObject({ as: "slides", format: "wide", pages: 4, sizePx: { w: 1280, h: 720 } });
    expect(d.label).toBe("Presentación · 4 diapositivas de 1920 × 1080");
  });

  it("un carrusel de 6 páginas de 1080 × 1350 se detecta como 4:5 (v45)", () => {
    const d = detectHtmlFormat(fixture("carrusel-4-5.html"));
    expect(d).toMatchObject({ as: "slides", format: "v45", pages: 6, sizePx: { w: 1080, h: 1350 } });
    expect(d.label).toBe("Presentación · 6 diapositivas de 1080 × 1350");
  });

  it("un archivo ambiguo (secciones de pantalla completa, un .page sin alto) es una página web", () => {
    expect(detectHtmlFormat(fixture("ambiguo.html"))).toMatchObject({ as: "web", format: "web", pages: 1 });
  });
});

describe("detectHtmlFormat: otros casos", () => {
  const deck = (css: string, slides: string) => `<html><head><style>${css}</style></head><body>${slides}</body></html>`;
  const slide = (cls: string, n: number) => Array.from({ length: n }, (_, i) => `<div class="${cls}"><h1>Título ${i}</h1></div>`).join("");

  it("1080 × 1920 es una historia (story) y 1080 × 1080 es cuadrado (sq)", () => {
    expect(detectHtmlFormat(deck(".slide{width:1080px;height:1920px}", slide("slide", 3)))).toMatchObject({ as: "slides", format: "story", pages: 3 });
    expect(detectHtmlFormat(deck(".slide{width:1080px;height:1080px}", slide("slide", 2)))).toMatchObject({ as: "slides", format: "sq", pages: 2 });
  });

  it("una sola diapositiva con tamaño fijo y sin @page no alcanza: es web", () => {
    expect(detectHtmlFormat(deck(".slide{width:1920px;height:1080px}", slide("slide", 1)))).toMatchObject({ as: "web" });
  });

  it("dos secciones con clase pero sin tamaño ni reglas son web", () => {
    expect(detectHtmlFormat(deck(".section{padding:40px}", slide("section", 4)))).toMatchObject({ as: "web" });
  });

  it("un aspect-ratio de 4/5 en las diapositivas las vuelve presentación 4:5", () => {
    const d = detectHtmlFormat(deck(".slide{aspect-ratio:4/5;width:100%}", slide("slide", 3)));
    expect(d).toMatchObject({ as: "slides", format: "v45", pages: 3 });
  });

  it("el tamaño puede venir en el atributo style de cada diapositiva", () => {
    const html = `<body>${Array.from({ length: 3 }, () => `<section class="page" style="width:1920px;height:1080px">x</section>`).join("")}</body>`;
    expect(detectHtmlFormat(html)).toMatchObject({ as: "slides", format: "wide", pages: 3 });
  });

  it("un tamaño que no es ninguno de los cuatro (4:3) va al formato más cercano", () => {
    const d = detectHtmlFormat(deck(".slide{width:1024px;height:768px}", slide("slide", 2)));
    expect(d).toMatchObject({ as: "slides", sizePx: { w: 1024, h: 768 } });
    expect(["wide", "sq"]).toContain(d.format);
  });

  it("un archivo vacío o sin etiquetas es web", () => {
    expect(detectHtmlFormat("")).toMatchObject({ as: "web" });
    expect(detectHtmlFormat("solo texto")).toMatchObject({ as: "web" });
  });

  it("funciona igual sobre el contenido ya limpio más su CSS (sin <html> ni <head>)", () => {
    const css = ".slide{width:1920px;height:1080px}";
    const html = `<div class="slide"><h1>a</h1></div><div class="slide"><h1>b</h1></div>`;
    expect(detectFromParts({ html, css })).toMatchObject({ as: "slides", format: "wide", pages: 2 });
  });
});

describe("proporciones", () => {
  it("las cuatro conocidas", () => {
    expect(formatForRatio(16 / 9)).toBe("wide");
    expect(formatForRatio(0.8)).toBe("v45");
    expect(formatForRatio(9 / 16)).toBe("story");
    expect(formatForRatio(1)).toBe("sq");
    expect(formatForRatio(1.4)).toBeNull();
  });

  it("la más cercana", () => {
    expect(nearestSlideFormat(4 / 3)).toBe("sq");
    expect(nearestSlideFormat(2.4)).toBe("wide");
    expect(nearestSlideFormat(0)).toBe("wide");
  });
});

describe("splitSlides y alto de una página web", () => {
  it("devuelve el HTML de cada diapositiva", () => {
    const parts = { html: `<div class="slide"><h1>a</h1></div><div class="slide"><h1>b</h1></div>`, css: "" };
    expect(splitSlides(parts)).toEqual([`<div class="slide"><h1>a</h1></div>`, `<div class="slide"><h1>b</h1></div>`]);
  });

  it("sin diapositivas con clase, cada elemento de primer nivel es una", () => {
    expect(splitSlides({ html: `<h1>a</h1><p>b</p><div>c</div>`, css: "" })).toHaveLength(3);
  });

  it("si todo está dentro de un contenedor, las diapositivas son sus hijos", () => {
    expect(splitSlides({ html: `<main><section>a</section><section>b</section></main>`, css: "" })).toEqual(["<section>a</section>", "<section>b</section>"]);
  });

  it("el alto estimado de una web va entre 2.000 y 20.000", () => {
    expect(estimateWebHeight({ html: "<p>a</p>", css: "" })).toBe(2000);
    const many = Array.from({ length: 50 }, () => "<section>x</section>").join("");
    expect(estimateWebHeight({ html: many, css: "" })).toBe(20_000);
  });
});
