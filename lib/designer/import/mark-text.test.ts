import { describe, expect, it } from "vitest";
import { docVariables, emptyDoc, newId, parseDesignDoc, type DesignDoc, type HtmlElement } from "../doc/schema";
import { renderPageHTML } from "../render/page-html";
import { ownAssetRef, sanitizeDocHtml, setNodeText } from "./edit";
import { isImportedPage, IMPORTED_PAGE_NAME } from "./imported-page";
import { listEditableTexts, markEditableText, replaceNodeText } from "./mark-text";
import { sanitizeImportedHtml } from "./sanitize";

const WS = "11111111-2222-3333-4444-555555555555";
const OTHER_WS = "99999999-2222-3333-4444-555555555555";
const ref = ownAssetRef(WS);

const PAGE = `<section class="hero"><h1>Aprendé a ordenar</h1><p>Una clase de <b>Academia Ejemplo</b> para todos.</p><a href="#x">Quiero mi lugar</a><ul>\n<li>Primero</li>\n<li>Segundo</li>\n</ul></section>`;

describe("F42: marcar los textos editables", () => {
  it("cada elemento que solo tiene texto recibe su data-tx", () => {
    const { html, count } = markEditableText(`<h1>Título</h1><p>Texto</p>`);
    expect(html).toBe(`<h1 data-tx="tx1">Título</h1><p data-tx="tx2">Texto</p>`);
    expect(count).toBe(2);
  });

  it("el texto suelto que convive con otros elementos se envuelve en un span", () => {
    const { html } = markEditableText(`<p>Una clase de <b>Academia Ejemplo</b> para todos.</p>`);
    expect(html).toBe(`<p><span data-tx="tx1">Una clase de </span><b data-tx="tx2">Academia Ejemplo</b><span data-tx="tx3"> para todos.</span></p>`);
  });

  it("los ids son únicos y los textos salen en orden", () => {
    const marked = markEditableText(PAGE).html;
    const list = listEditableTexts(marked);
    expect(list.map((t) => t.text)).toEqual(["Aprendé a ordenar", "Una clase de ", "Academia Ejemplo", " para todos.", "Quiero mi lugar", "Primero", "Segundo"]);
    expect(list.map((t) => t.id)).toEqual(["tx1", "tx2", "tx3", "tx4", "tx5", "tx6", "tx7"]);
    expect(new Set(list.map((t) => t.id)).size).toBe(list.length);
  });

  it("los espacios entre elementos y los &nbsp; no se marcan", () => {
    const { html } = markEditableText(`<ul>\n  <li>A</li>\n  <li>B</li>\n</ul><p>&nbsp;</p><div> </div>`);
    expect(html).toBe(`<ul>\n  <li data-tx="tx1">A</li>\n  <li data-tx="tx2">B</li>\n</ul><p>&nbsp;</p><div> </div>`);
  });

  it("no marca nada adentro de svg, script, style, textarea ni select", () => {
    const { html, count } = markEditableText(`<svg><text>x</text></svg><script>var a = 1;</script><style>.a{}</style><textarea>t</textarea><select><option>o</option></select>`);
    expect(count).toBe(0);
    expect(html).not.toContain("data-tx");
  });

  it("un elemento marcado es una unidad: no se marca nada adentro", () => {
    const first = markEditableText(`<p>hola <b>mundo</b></p>`).html;
    // el usuario agrega saltos de línea adentro de un nodo marcado
    const edited = setNodeText(first, "tx1", "uno\ndos", ref) as string;
    expect(edited).toContain("uno<br />dos");
    expect(markEditableText(edited).html).toBe(edited);
  });

  it("marcar dos veces da lo mismo que una vez", () => {
    const once = markEditableText(PAGE).html;
    expect(markEditableText(once)).toEqual({ html: once, count: 0 });
  });

  it("un texto nuevo después de marcar recibe un id que no se repite", () => {
    const once = markEditableText(`<p>a</p>`).html;
    const added = markEditableText(`${once}<p>b</p>`).html;
    expect(added).toBe(`<p data-tx="tx1">a</p><p data-tx="tx2">b</p>`);
  });

  it("el texto suelto de primer nivel también se marca", () => {
    expect(markEditableText(`Hola <b>mundo</b>`).html).toBe(`<span data-tx="tx1">Hola </span><b data-tx="tx2">mundo</b>`);
  });

  it("deja intactas las entidades y las variables", () => {
    const { html } = markEditableText(`<p>Tom &amp; Jerry {{contact.first_name}}</p>`);
    expect(html).toBe(`<p data-tx="tx1">Tom &amp; Jerry {{contact.first_name}}</p>`);
    expect(listEditableTexts(html)).toEqual([{ id: "tx1", text: "Tom & Jerry {{contact.first_name}}" }]);
  });

  it("no se cuelga con HTML roto", () => {
    expect(() => markEditableText(`<p>a<b>c</p></div><<>>`)).not.toThrow();
    expect(() => listEditableTexts(`<p data-tx="tx1">sin cerrar`)).not.toThrow();
  });
});

describe("F42: editar un texto marcado cambia SOLO ese nodo", () => {
  const marked = markEditableText(PAGE).html;
  const texts = listEditableTexts(marked);
  const target = texts.find((t) => t.text === "Quiero mi lugar") as { id: string; text: string };

  it("cambia el texto de ese nodo y nada más", () => {
    const next = setNodeText(marked, target.id, "Reservar mi lugar", ref) as string;
    expect(next).toContain(`>Reservar mi lugar</a>`);
    // todo lo demás, igual: deshaciendo el cambio se vuelve al HTML original
    expect(next.replace("Reservar mi lugar", "Quiero mi lugar")).toBe(marked);
    const after = listEditableTexts(next);
    expect(after.filter((t) => t.id !== target.id)).toEqual(texts.filter((t) => t.id !== target.id));
    expect(after.find((t) => t.id === target.id)?.text).toBe("Reservar mi lugar");
  });

  it("un texto con <, & y comillas se guarda como texto, no como etiquetas", () => {
    const next = setNodeText(marked, target.id, `Tom & "Jerry" <b>x</b>`, ref) as string;
    expect(next).toContain(`Tom &amp; "Jerry" &lt;b&gt;x&lt;/b&gt;`);
    expect(next).not.toContain("<b>x</b>");
    expect(listEditableTexts(next).find((t) => t.id === target.id)?.text).toBe(`Tom & "Jerry" <b>x</b>`);
  });

  it("un texto que mete un <script> queda como texto inofensivo", () => {
    const next = setNodeText(marked, target.id, `<script>alert(1)</script>`, ref) as string;
    expect(next).not.toMatch(/<script/i);
    expect(next).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("una plantilla puede poner una variable adentro", () => {
    const next = setNodeText(marked, target.id, "Hola {{contact.first_name}}", ref) as string;
    expect(next).toContain(">Hola {{contact.first_name}}</a>");
    const doc = emptyDoc("web");
    doc.pages[0].elements.push({ id: newId("el"), type: "html", x: 50, y: 50, w: 100, h: 100, html: next });
    expect(docVariables(doc)).toEqual(["contact.first_name"]);
  });

  it("un nodo que no existe devuelve null y no cambia nada", () => {
    expect(setNodeText(marked, "tx999", "x", ref)).toBeNull();
    expect(replaceNodeText(marked, "tx999", "x")).toBeNull();
  });

  it("el tope de un texto es de 5.000 caracteres", () => {
    const next = setNodeText(marked, target.id, "a".repeat(9000), ref) as string;
    expect(listEditableTexts(next).find((t) => t.id === target.id)?.text).toHaveLength(5000);
  });
});

function docWith(html: string, css?: string): DesignDoc {
  const doc = emptyDoc("web");
  const el: HtmlElement = { id: newId("el"), type: "html", name: IMPORTED_PAGE_NAME, x: 50, y: 50, w: 100, h: 100, html };
  if (css !== undefined) el.css = css;
  doc.pages[0].elements.push(el);
  return doc;
}

describe("F42: un parche (de la IA o de la persona) siempre vuelve a pasar por la limpieza al guardar", () => {
  it("un parche que mete un <script> queda limpio", () => {
    const patched = docWith(`<p data-tx="tx1">Hola</p><script>alert(1)</script><img src="https://ejemplo.test/a.png" onerror="alert(2)">`);
    const r = sanitizeDocHtml(patched, WS);
    const el = r.doc.pages[0].elements[0] as HtmlElement;
    expect(el.html).toBe(`<p data-tx="tx1">Hola</p><img src="https://ejemplo.test/a.png" />`);
    expect(r.changed).toBe(true);
    expect(r.removed.scripts).toBe(1);
    expect(r.removed.other).toBeGreaterThanOrEqual(1);
  });

  it("y el CSS del parche también", () => {
    const r = sanitizeDocHtml(docWith(`<p>a</p>`, `body{background:url(https://evil.example/x.png);color:red} .a{width:expression(alert(1))}`), WS);
    const el = r.doc.pages[0].elements[0] as HtmlElement;
    expect(el.css).toBe(".dz-import{color:red;}");
  });

  it("lo que ya está limpio no cambia (y limpiar dos veces da lo mismo)", () => {
    const clean = docWith(markEditableText(sanitizeImportedHtml(PAGE, { assetRef: () => null }).html).html, ".hero{color:red;}");
    const once = sanitizeDocHtml(clean, WS);
    expect(once.changed).toBe(false);
    expect(sanitizeDocHtml(once.doc, WS).doc).toEqual(once.doc);
  });

  it("conserva los asset: de este negocio y quita los de otro", () => {
    const html = `<img src="asset:${WS}/imports/up/a.png"><img src="asset:${OTHER_WS}/imports/up/b.png">`;
    const el = sanitizeDocHtml(docWith(html, `.a{background:url("asset:${WS}/imports/up/a.png")} .b{background:url("asset:${OTHER_WS}/imports/up/b.png")}`), WS).doc.pages[0].elements[0] as HtmlElement;
    expect(el.html).toContain(`asset:${WS}/imports/up/a.png`);
    expect(el.html).not.toContain(OTHER_WS);
    expect(el.css).toContain(`asset:${WS}/imports/up/a.png`);
    expect(el.css).not.toContain(OTHER_WS);
  });

  it("un data-tx falso se descarta y uno válido se conserva", () => {
    const el = sanitizeDocHtml(docWith(`<p data-tx="tx1">a</p><p data-tx="x onclick=alert(1)">b</p>`), WS).doc.pages[0].elements[0] as HtmlElement;
    expect(el.html).toBe(`<p data-tx="tx1">a</p><p>b</p>`);
  });

  it("no toca los elementos que no son html", () => {
    const doc = emptyDoc("sq");
    doc.pages[0].elements.push({ id: newId("el"), type: "text", x: 50, y: 50, w: 50, text: "<script>alert(1)</script>", font: { family: "Inter", weight: 400 }, size: 40, align: "left", color: "#000000" });
    const r = sanitizeDocHtml(doc, WS);
    expect(r.changed).toBe(false);
    expect(r.doc).toEqual(doc);
  });

  it("el resultado sigue siendo un documento válido y el render nunca produce un <script>", () => {
    const r = sanitizeDocHtml(docWith(`<p>a</p><script>alert(1)</script>`, `.a{color:red}`), WS);
    const parsed = parseDesignDoc(r.doc);
    expect(parsed.ok).toBe(true);
    const page = renderPageHTML(r.doc, 0, { mode: "public", assetUrl: () => "", values: {} });
    expect(page).not.toMatch(/<script/i);
    expect(page).toContain("<p>a</p>");
  });
});

describe("páginas cargadas", () => {
  const base = { id: "el_aaaaaaaa", x: 50, y: 50, w: 100, h: 100 };

  it("un html que ocupa toda la página es una página cargada", () => {
    expect(isImportedPage({ ...base, type: "html", html: "<p>a</p>" })).toBe(true);
    expect(isImportedPage({ ...base, type: "html", w: 50, html: "<p>a</p>" })).toBe(false);
    expect(isImportedPage({ ...base, type: "shape", shape: "rect" })).toBe(false);
  });

  it("las capas la muestran como «Página cargada (HTML)»", () => {
    expect(IMPORTED_PAGE_NAME).toBe("Página cargada (HTML)");
  });
});
