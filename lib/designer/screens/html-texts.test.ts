import { describe, expect, it } from "vitest";
import type { HtmlElement } from "../doc/schema";
import { listEditableTexts, markEditableText } from "../import/mark-text";
import { applyHtmlText, designBox, designPoint, htmlTextName, htmlTextOf, htmlTextRows } from "./html-texts";

const HTML = markEditableText(`<div class="dz-import"><p>Se otorga a</p><h1>{{contact.name}}</h1><h2>Builder de Sistemas con IA</h2><p>Por completar el programa con excelencia y construir de inicio a fin un sistema con IA para un negocio real.</p></div>`).html;
const el = (html = HTML): HtmlElement => ({ id: "el_1", type: "html", x: 50, y: 50, w: 100, h: 100, html });
const label = (key: string) => (key === "contact.name" ? "Nombre completo" : key);
const ids = listEditableTexts(HTML).map((t) => t.id);

describe("los textos de un HTML cargado", () => {
  it("una sub-fila por texto marcado, en orden, con las variables como etiqueta y recortadas", () => {
    const rows = htmlTextRows(el(), label);
    expect(rows.map((r) => r.name)).toEqual(["Se otorga a", "[Nombre completo]", "Builder de Sistemas con IA", "Por completar el programa con excelencia…"]);
    expect(rows.map((r) => r.tx)).toEqual(ids);
  });

  it("un HTML sin marcas no tiene sub-filas", () => {
    expect(htmlTextRows(el("<div><img src=\"x.png\" /></div>"))).toEqual([]);
  });

  it("un texto vacío se nombra igual, para poder tocarlo", () => {
    expect(htmlTextName("   ")).toBe("Texto vacío");
  });

  it("devuelve el texto guardado (con sus variables) y null si la marca no existe", () => {
    expect(htmlTextOf(el(), ids[1])).toBe("{{contact.name}}");
    expect(htmlTextOf(el(), "tx999")).toBeNull();
  });

  it("cambia SOLO ese texto y deja el resto del HTML igual", () => {
    const next = applyHtmlText(el(), ids[2], "Builder de Agentes");
    expect(htmlTextOf(next, ids[2])).toBe("Builder de Agentes");
    expect(htmlTextOf(next, ids[0])).toBe("Se otorga a");
    expect(next.html.replace("Builder de Agentes", "Builder de Sistemas con IA")).toBe(HTML);
  });

  it("puede meter una variable y un salto de línea", () => {
    const next = applyHtmlText(el(), ids[0], "Hola {{contact.first_name}}\notra línea");
    expect(next.html).toContain("Hola {{contact.first_name}}<br />otra línea");
  });

  it("lo que se escribe nunca entra como HTML", () => {
    const next = applyHtmlText(el(), ids[0], `<img src=x onerror="alert(1)">`);
    expect(next.html).not.toMatch(/<img src=x/);
    expect(next.html).toContain("&lt;img");
  });

  it("si no cambió nada o la marca no existe, devuelve el MISMO elemento (no suma un paso al historial)", () => {
    const base = el();
    expect(applyHtmlText(base, ids[2], "Builder de Sistemas con IA")).toBe(base);
    expect(applyHtmlText(base, "tx999", "otro")).toBe(base);
  });
});

describe("de la pantalla al diseño", () => {
  it("un punto se pasa a px del diseño con la escala de la página", () => {
    expect(designPoint({ x: 300, y: 250 }, { left: 100, top: 50 }, 0.5)).toEqual({ x: 400, y: 400 });
    expect(designPoint({ x: 10, y: 10 }, { left: 0, top: 0 }, 0)).toEqual({ x: 10, y: 10 });
  });

  it("el recuadro lleva un margen y no existe si el texto no se ve", () => {
    expect(designBox({ left: 10, top: 20, width: 100, height: 30 })).toEqual({ left: 7, top: 17, width: 106, height: 36 });
    expect(designBox({ left: 10, top: 20, width: 0, height: 0 })).toBeNull();
  });
});
