import { describe, expect, it } from "vitest";
import { IMPORT_BASE_CSS, parseCss, sanitizeCss, sanitizeStyleAttribute, scopeRootSelectors, serializeCss, unescapeCss, type AssetRef } from "./css";

const ZIP: AssetRef = (url) => (/^(img|fonts)\//.test(url) ? `asset:ws/imports/up/${url.replace("/", "__")}` : null);
const run = (css: string, assetRef: AssetRef = ZIP) => sanitizeCss(css, { assetRef });

describe("sanitizeCss (F40): @import", () => {
  it("un @import externo se quita", () => {
    const r = run(`@import url("https://evil.example/a.css"); @import "https://evil.example/b.css"; .a{color:red}`);
    expect(r.css).toBe(".a{color:red;}");
    expect(r.removed).toBe(2);
  });

  it("un @import de Google Fonts se conserva (con url() o con texto)", () => {
    const gf = "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap";
    expect(run(`@import url("${gf}");`).css).toBe(`@import url("${gf}");`);
    expect(run(`@import '${gf}';`).css).toBe(`@import url("${gf}");`);
  });

  it("un @import que dice ser de Google pero es de otro dominio se quita", () => {
    expect(run(`@import url("https://fonts.googleapis.com.evil.example/x.css");`).css).toBe("");
    expect(run(`@import url("https://evil.example/https://fonts.googleapis.com/x");`).css).toBe("");
  });

  it("@charset, @namespace y un at-rule desconocido se quitan", () => {
    expect(run(`@charset "utf-8"; @namespace svg url(http://www.w3.org/2000/svg); @document url(x){a{color:red}} .a{color:red}`).css).toBe(".a{color:red;}");
  });
});

describe("sanitizeCss: url()", () => {
  it("una url() de un recurso del zip pasa a asset:<ruta>", () => {
    expect(run(`.a{background:url(img/a.png) no-repeat}`).css).toBe(`.a{background:url("asset:ws/imports/up/img__a.png") no-repeat;}`);
    expect(run(`.a{background:url('img/a.png')}`).css).toBe(`.a{background:url("asset:ws/imports/up/img__a.png");}`);
  });

  it("una url() externa quita la declaración, no la regla", () => {
    const r = run(`.a{color:red;background:url(https://evil.example/x.png);margin:0}`);
    expect(r.css).toBe(".a{color:red;margin:0;}");
    expect(r.removed).toBe(1);
  });

  it("una url() de Google Fonts se conserva y la de otro dominio no", () => {
    expect(run(`@font-face{font-family:X;src:url(https://fonts.gstatic.com/s/inter/v1/a.woff2) format("woff2")}`).css).toContain("https://fonts.gstatic.com/s/inter/v1/a.woff2");
    expect(run(`.a{background:url(https://fonts.gstatic.com.evil.example/a.png)}`).css).toBe("");
  });

  it("un #ancla (filtros y máscaras de un SVG) se conserva", () => {
    expect(run(`.a{filter:url(#blur)}`).css).toBe(`.a{filter:url("#blur");}`);
  });

  it("una imagen en línea (png) pasa por quien llama; otros data: se quitan", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(run(`.a{background:url(${png})}`, (u) => u).css).toBe(`.a{background:url("${png}");}`);
    expect(run(`.a{background:url(data:text/html;base64,PHNjcmlwdD4=)}`, (u) => u).css).toBe("");
    expect(run(`.a{background:url(data:image/svg+xml;base64,PHN2Zz4=)}`, (u) => u).css).toBe("");
  });

  it("en @font-face, la fuente de afuera sale y la del zip queda", () => {
    const r = run(`@font-face{font-family:X;src:url(fonts/x.woff2) format("woff2"),url(https://evil.example/f.woff) format("woff")}`);
    expect(r.css).toBe(`@font-face{font-family:X;src:url("asset:ws/imports/up/fonts__x.woff2") format("woff2");}`);
  });

  it("si ninguna fuente sirve, se quita el src", () => {
    expect(run(`@font-face{font-family:X;src:url(https://evil.example/f.woff)}`).css).toBe(`@font-face{font-family:X;}`);
  });

  it("una url() disfrazada con escapes se quita", () => {
    expect(run(`.a{background:u\\72l(javascript:alert(1))}`).css).toBe("");
    expect(run(`.a{background:\\75 rl(https://evil.example/x)}`).css).toBe("");
  });

  it("image-set(), src() y paint() se quitan", () => {
    expect(run(`.a{background-image:image-set("a.png" 1x)}`).css).toBe("");
    expect(run(`.a{background-image:-webkit-image-set(url(img/a.png) 1x)}`).css).toBe("");
    expect(run(`.a{background:paint(worklet)}`).css).toBe("");
  });
});

describe("sanitizeCss: lo ejecutable y lo que se escapa", () => {
  it.each([
    ["expression()", `.a{width:expression(alert(1))}`],
    ["expression() con escapes", `.a{width:\\65 xpression(alert(1))}`],
    ["javascript:", `.a{background:url(javascript:alert(1))}`],
    ["javascript: con escapes", `.a{background:url(\\6a avascript:alert(1))}`],
    ["behavior", `.a{behavior:url(x.htc)}`],
    ["-moz-binding", `.a{-moz-binding:url(x)}`],
    ["una propiedad con escapes", `.a{\\62 ehavior:url(x)}`],
    ["cerrar el style", `.a{content:"</style><script>alert(1)</script>"}`],
    ["cerrar el style con escapes en el selector", `a</style><script>alert(1)</script>{color:red}`],
    ["@import adentro de un valor", `.a{background:@import url(x)}`],
  ])("%s no sobrevive", (_name, css) => {
    const out = run(css).css;
    expect(out).not.toMatch(/expression\s*\(|javascript\s*:|behavior|binding|<|@import/i);
  });

  it("un comentario no esconde nada", () => {
    expect(run(`.a{background:url(/*x*/javascript:alert(1))}`).css).toBe("");
    expect(run(`.a{/* ok */color:red;/* background:url(javascript:alert(1)) */}`).css).toBe(".a{color:red;}");
  });

  it("los escapes se decodifican solo para mirar: lo que se guarda es el original", () => {
    const out = run(`.a{content:"\\201C hola \\201D"}`).css;
    expect(out).toBe(`.a{content:"\\201C hola \\201D";}`);
    expect(unescapeCss("\\6a avascript")).toBe("javascript");
  });

  it("position: fixed pasa a absolute", () => {
    expect(run(`.nav{position:fixed;top:0}`).css).toBe(".nav{position:absolute;top:0;}");
    expect(run(`.nav{position:sticky}`).css).toBe(".nav{position:sticky;}");
  });

  it("una regla que queda vacía no se escribe", () => {
    expect(run(`.a{background:url(https://evil.example/x)}`).css).toBe("");
  });

  it("no se cuelga con un CSS roto o muy anidado", () => {
    expect(() => run("a{b{c{d{e{f{g{h{i{j{k{color:red")).not.toThrow();
    expect(() => run("}}}{{{;;; @media")).not.toThrow();
    expect(() => run(`.a{content:"sin cerrar`)).not.toThrow();
  });
});

describe("sanitizeCss: lo que se conserva", () => {
  it("conserva media queries, keyframes y variables", () => {
    const css = `:root{--c:#fff} @media (max-width:600px){.a{color:var(--c)}} @keyframes pop{from{opacity:0}to{opacity:1}} .b{animation:pop 1s}`;
    const out = run(css).css;
    expect(out).toContain(".dz-import{--c:#fff;}");
    expect(out).toContain("@media (max-width:600px){.a{color:var(--c);}}");
    expect(out).toContain("@keyframes pop{from{opacity:0;}to{opacity:1;}}");
    expect(out).toContain(".b{animation:pop 1s;}");
  });

  it("una regla !important mantiene su prioridad", () => {
    expect(run(`.a{color:red !important}`).css).toBe(".a{color:red !important;}");
  });

  it("los selectores de un @keyframes y de @page no se tocan", () => {
    expect(run(`@page{size:1920px 1080px;margin:0}`).css).toBe("@page{size:1920px 1080px;margin:0;}");
  });
});

describe("raíz del documento", () => {
  it("html, body y :root pasan a .dz-import", () => {
    expect(scopeRootSelectors("body")).toBe(".dz-import");
    expect(scopeRootSelectors("html, body")).toBe(".dz-import");
    expect(scopeRootSelectors(":root")).toBe(".dz-import");
    expect(scopeRootSelectors("body .card > p")).toBe(".dz-import .card > p");
    expect(scopeRootSelectors("html body main")).toBe(".dz-import main");
    expect(scopeRootSelectors("body.dark")).toBe(".dz-import.dark");
  });

  it("no toca nombres que contienen body o html", () => {
    expect(scopeRootSelectors(".body-text")).toBe(".body-text");
    expect(scopeRootSelectors("#html5")).toBe("#html5");
    // las comas de adentro de :not(...) no se pierden ni se repiten
    expect(scopeRootSelectors("a:not(.x, .y), b:not(.x, .y)")).toBe("a:not(.x,.y),b:not(.x,.y)");
  });
});

describe("la base de lo cargado", () => {
  it("devuelve los márgenes del navegador sin pesar nada, y sobrevive a la limpieza tal cual", () => {
    expect(IMPORT_BASE_CSS).toBe(":where(.dz-import) *{margin:revert;padding:revert;box-sizing:content-box;}");
    expect(run(IMPORT_BASE_CSS).css).toBe(IMPORT_BASE_CSS);
  });
});

describe("estilos en línea", () => {
  it("un atributo style se limpia declaración por declaración", () => {
    const r = sanitizeStyleAttribute(`color:red;background:url(https://evil.example/x.png);width:expression(alert(1));margin:0`, { assetRef: ZIP });
    expect(r.style).toBe("color:red;margin:0");
    expect(r.removed).toBe(2);
  });

  it("deja pasar un recurso del zip", () => {
    expect(sanitizeStyleAttribute(`background:url(img/a.png)`, { assetRef: ZIP }).style).toBe(`background:url("asset:ws/imports/up/img__a.png")`);
  });
});

describe("lector y escritor", () => {
  it("ida y vuelta de una hoja", () => {
    const css = `.a{color:red;}\n@media (min-width:1px){.b{margin:0;}}`;
    expect(serializeCss(parseCss(css))).toBe(css);
  });
});
