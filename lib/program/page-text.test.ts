// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { pageText } from "./page-text";

describe("pageText", () => {
  it("se queda con lo que se lee: sin head, estilos, scripts ni comentarios", () => {
    const html = `<!DOCTYPE html><html><head><title>Tab</title><style>.a{color:red}</style></head>
      <body><!-- nota --><h1>Elegí qué skill vas a hacer</h1><p>La regla es <b>simple</b>: algo que hagas seguido.</p>
      <script>var x = "no va";</script></body></html>`;
    expect(pageText(html)).toBe("Elegí qué skill vas a hacer\n\nLa regla es simple: algo que hagas seguido.");
  });

  it("listas con guion, saltos de renglón y entidades", () => {
    const html = `<ul><li>Abrí Claude &amp; entrá</li><li>Probá &laquo;/brief&raquo;&nbsp;ya</li></ul><p>Uno<br>Dos &#8594; &#x2713;</p>`;
    expect(pageText(html)).toBe("- Abrí Claude & entrá\n- Probá «/brief» ya\n\nUno\nDos → ✓");
  });

  it("el <pre> conserva sus renglones", () => {
    const html = `<style>.rx{}</style><div class="rx"><b>Prompt</b><pre id="c1">Armá una landing.
  Secciones: quién soy.</pre></div>`;
    expect(pageText(html)).toBe("Prompt\n\nArmá una landing.\n  Secciones: quién soy.");
  });

  it("etiquetas en línea pegadas quedan separadas; dentro de una palabra no", () => {
    const html = `<div class="level"><span class="lv">Para arrancar</span><span class="small">Solo Claude.</span></div><p>Hola <b>mun</b>do</p>`;
    expect(pageText(html)).toBe("Para arrancar Solo Claude.\n\nHola mundo");
  });

  it("vacío o sin texto da cadena vacía", () => {
    expect(pageText(null)).toBe("");
    expect(pageText("   ")).toBe("");
    expect(pageText("<style>a{}</style><script>1</script>")).toBe("");
  });
});
