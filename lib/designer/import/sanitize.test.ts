import { describe, expect, it } from "vitest";
import type { AssetRef } from "./css";
import { tokenizeHtml } from "./html-scan";
import { ALLOWED_TAGS, removedSummary, sanitizeImportedHtml } from "./sanitize";

const none: AssetRef = () => null;
const clean = (html: string, assetRef: AssetRef = none) => sanitizeImportedHtml(html, { assetRef });

/** Lo que NO puede quedar en ninguna salida: nada ejecutable, ni una etiqueta fuera de la lista. */
function expectInert(out: string) {
  const tokens = tokenizeHtml(out);
  for (const t of tokens) {
    if (t.kind === "open") {
      expect(ALLOWED_TAGS, `etiqueta <${t.name}> en: ${out}`).toContain(t.name);
      for (const a of t.attrs) {
        expect(a.name, `atributo ${a.name} en: ${out}`).not.toMatch(/^on/);
        expect(a.name).not.toBe("srcdoc");
        const probe = a.value.replace(/[\u0000- ]+/g, "").toLowerCase();
        expect(probe, `valor de ${a.name} en: ${out}`).not.toMatch(/javascript:|vbscript:|data:text|expression\(/);
      }
    }
    if (t.kind === "close") expect(ALLOWED_TAGS).toContain(t.name);
    if (t.kind === "comment") throw new Error(`comentario en la salida: ${out}`);
  }
  expect(out).not.toMatch(/<\s*script/i);
}

const ATTACKS: [string, string][] = [
  ["script directo", `<script>alert(1)</script><p>hola</p>`],
  ["script con src externo", `<script src="https://evil.example/x.js"></script><p>hola</p>`],
  ["XSS por atributo onerror", `<img src=x onerror=alert(1)>`],
  ["mayúsculas mezcladas", `<IMG SRC=x OnErRoR=alert(1)><SCRIPT>alert(1)</SCRIPT>`],
  ["onerror pegado con barras", `<img/src=x/onerror=alert(1)>`],
  ["onclick en un div", `<div onclick="alert(1)" onmouseover="alert(2)">hola</div>`],
  ["onload en el body", `<body onload=alert(1)><p>hola</p></body>`],
  ["details con ontoggle", `<details open ontoggle=alert(1)><summary>x</summary></details>`],
  ["link javascript:", `<a href="javascript:alert(1)">hola</a>`],
  ["link JaVaScRiPt: con mayúsculas", `<a href="JaVaScRiPt:alert(1)">hola</a>`],
  ["link con entidades (jav&#x61;script:)", `<a href="jav&#x61;script:alert(1)">hola</a>`],
  ["link con entidades decimales y tab", `<a href="&#106;&#97;&#118;&#97;&#9;script:alert(1)">hola</a>`],
  ["link con blancos antes del esquema", `<a href="  \u0001javascript:alert(1)">hola</a>`],
  ["link vbscript:", `<a href="vbscript:msgbox(1)">hola</a>`],
  ["link data:text/html", `<a href="data:text/html,<script>alert(1)</script>">hola</a>`],
  ["imagen con data:text/html", `<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">`],
  ["imagen con data:image/svg+xml", `<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">`],
  ["imagen con javascript:", `<img src="javascript:alert(1)">`],
  ["imagen con un esquema inventado", `<img src="x:alert(1)">`],
  ["iframe con srcdoc", `<iframe srcdoc="<script>alert(1)</script>"></iframe>`],
  ["iframe a otro sitio", `<iframe src="https://evil.example/x"></iframe>`],
  ["iframe javascript:", `<iframe src="javascript:alert(1)"></iframe>`],
  ["object y embed", `<object data="javascript:alert(1)"></object><embed src="javascript:alert(1)">`],
  ["svg con script", `<svg><script>alert(1)</script></svg>`],
  ["svg con onload", `<svg onload=alert(1)><circle r="5"/></svg>`],
  ["svg con xlink:href javascript:", `<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`],
  ["svg con use", `<svg><use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/></svg>`],
  ["svg con animate", `<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>`],
  ["svg con foreignObject", `<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>`],
  ["CSS con expression()", `<div style="width:expression(alert(1))">hola</div>`],
  ["CSS con url(javascript:)", `<div style="background:url(javascript:alert(1))">hola</div>`],
  ["CSS con url() disfrazada con entidades", `<div style="background:u&#x72;l(javascript:alert(1))">hola</div>`],
  ["CSS con escapes (\\75 rl)", `<div style="background:\\75 rl(javascript:alert(1))">hola</div>`],
  ["CSS con behavior y -moz-binding", `<div style="behavior:url(x.htc);-moz-binding:url(x)">hola</div>`],
  ["<scr<script>ipt>", `<scr<script>ipt>alert(1)</scr</script>ipt>`],
  ["script partido en dos", `<scr<!-- -->ipt>alert(1)</scr<!-- -->ipt>`],
  ["entidades en una etiqueta (se ven como texto)", `&lt;script&gt;alert(1)&lt;/script&gt;`],
  ["form con action javascript:", `<form action="javascript:alert(1)"><input type="submit" formaction="javascript:alert(1)"></form>`],
  ["botón con formaction", `<button formaction="javascript:alert(1)">x</button>`],
  ["input de tipo imagen", `<input type="image" src="javascript:alert(1)">`],
  ["meta refresh", `<meta http-equiv="refresh" content="0;url=javascript:alert(1)">`],
  ["base", `<base href="javascript:alert(1)//"><a href="x">hola</a>`],
  ["link de hoja de estilos con javascript:", `<link rel="stylesheet" href="javascript:alert(1)">`],
  ["noscript con mXSS", `<noscript><p title="</noscript><img src=x onerror=alert(1)>">hola</p></noscript>`],
  ["xmp con una imagen", `<xmp><img src=x onerror=alert(1)></xmp>`],
  ["textarea con un script", `<textarea><script>alert(1)</script></textarea>`],
  ["math con style (mXSS)", `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">`],
  ["template", `<template><script>alert(1)</script></template>`],
  ["video con source y onerror", `<video><source onerror=alert(1)></video>`],
  ["comentario condicional", `<!--[if IE]><script>alert(1)</script><![endif]-->`],
  ["atributo style con comillas rotas", `<div style='background:url("javascript:alert(1)")'>hola</div>`],
  ["title con html adentro", `<p title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">hola</p>`],
];

describe("sanitizeImportedHtml (F40): ataques conocidos que NO sobreviven", () => {
  it("la lista tiene al menos 20 ataques", () => {
    expect(ATTACKS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(ATTACKS)("%s", (_name, html) => {
    const out = clean(html).html;
    expectInert(out);
    // y nada de lo que quedó vuelve a cambiar si se limpia otra vez
    expect(clean(out).html).toBe(out);
  });

  it("un texto con entidades queda como texto, nunca como etiqueta", () => {
    const out = clean(`&lt;script&gt;alert(1)&lt;/script&gt;`).html;
    expect(out).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("el contenido de un <script> y de un <style> no se cuela como texto", () => {
    expect(clean(`<p>a</p><script>var secreto = 1;</script><style>.x{color:red}</style>`).html).toBe("<p>a</p>");
  });

  it("el contenido de <head> y <title> no se cuela como texto", () => {
    const out = clean(`<html><head><title>Título del archivo</title><meta charset="utf-8"></head><body><p>hola</p></body></html>`).html;
    expect(out).toBe("<p>hola</p>");
  });
});

describe("sanitizeImportedHtml: lo que se conserva", () => {
  it("conserva el diseño: clases, estilos, títulos, listas, tablas y enlaces seguros", () => {
    const html = `<section class="hero" style="color:#fff;padding:20px"><h1>Hola</h1><a href="https://ejemplo.test/x" target="_blank">ir</a><a href="mailto:hola@ejemplo.test">m</a><a href="tel:+5491100000000">t</a><a href="#abajo">ancla</a><table><tr><td colspan="2">x</td></tr></table></section>`;
    const out = clean(html).html;
    expect(out).toContain(`class="hero"`);
    expect(out).toContain("color:#fff");
    expect(out).toContain(`href="https://ejemplo.test/x"`);
    expect(out).toContain(`rel="noopener noreferrer"`);
    expect(out).toContain(`href="mailto:hola@ejemplo.test"`);
    expect(out).toContain(`href="tel:+5491100000000"`);
    expect(out).toContain(`href="#abajo"`);
    expect(out).toContain("<td colspan=\"2\">x</td>");
  });

  it("conserva un SVG en línea sin scripts", () => {
    const out = clean(`<svg viewBox="0 0 10 10" width="20"><path d="M0 0L10 10" stroke="#000" fill="none"/><circle cx="5" cy="5" r="2"/></svg>`).html;
    expect(out).toContain("<svg");
    expect(out).toContain(`d="M0 0L10 10"`);
    expect(out).toContain("<circle");
  });

  it("deja las variables {{...}} como están", () => {
    expect(clean(`<p>Hola {{contact.first_name}}</p>`).html).toBe("<p>Hola {{contact.first_name}}</p>");
  });

  it("una imagen externa de https se conserva y una relativa sin zip se quita", () => {
    const out = clean(`<img src="https://ejemplo.test/a.png" alt="a"><img src="img/b.png" alt="b">`).html;
    expect(out).toContain(`src="https://ejemplo.test/a.png"`);
    expect(out).not.toContain("img/b.png");
  });

  it("una imagen del zip pasa a asset:<ruta> con lo que decide quien llama", () => {
    const out = clean(`<img src="img/b.png" alt="b"><img srcset="img/b.png 1x, img/c.png 2x" src="img/b.png">`, (u) => (u === "img/b.png" ? "asset:ws/imports/up/img__b.png" : null)).html;
    expect(out).toContain(`src="asset:ws/imports/up/img__b.png"`);
    expect(out).toContain(`srcset="asset:ws/imports/up/img__b.png 1x"`);
  });

  it("una imagen en línea (png) pasa por quien llama; una que no es imagen se quita", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(clean(`<img src="${png}">`, (u) => u).html).toContain(png);
    expect(clean(`<img src="data:application/pdf;base64,JVBERi0=">`, (u) => u).html).not.toContain("data:");
  });

  it("un asset: que trae el archivo (no lo puso la importación) se quita", () => {
    const out = clean(`<img src="asset:otro/imports/x/a.png">`).html;
    expect(out).not.toContain("asset:");
  });

  it("los atributos reservados del editor no entran", () => {
    const out = clean(`<p data-el="el_abc" data-el-type="html" data-page="pg_1" data-format="web" data-var="x" data-tx="tx1" data-otro="ok">a</p>`).html;
    expect(out).toBe(`<p data-otro="ok">a</p>`);
  });

  it("data-tx se conserva solo al volver a limpiar algo ya cargado, y solo con su forma", () => {
    const html = `<p data-tx="tx1">a</p><p data-tx="malo">b</p>`;
    expect(sanitizeImportedHtml(html, { assetRef: none, keepMarks: true }).html).toBe(`<p data-tx="tx1">a</p><p>b</p>`);
    expect(clean(html).html).toBe(`<p>a</p><p>b</p>`);
  });

  it("target se limita a _blank y siempre lleva rel seguro", () => {
    expect(clean(`<a href="https://a.test" target="_top">x</a>`).html).toBe(`<a href="https://a.test">x</a>`);
  });
});

describe("formularios y videos", () => {
  it("un formulario queda como un bloque visual: sin form, sin envío", () => {
    const out = clean(`<form action="/enviar" method="post"><label for="n">Nombre</label><input type="text" name="n" placeholder="Tu nombre"><input type="submit" value="Enviar"><button>Ir</button></form>`).html;
    expect(out).toContain("<div>");
    expect(out).not.toContain("<form");
    expect(out).not.toContain("action=");
    expect(out).toContain(`placeholder="Tu nombre"`);
    expect(out).toContain(`type="button"`);
    expect(out).not.toContain(`type="submit"`);
    expect(out).not.toContain(` name=`);
  });

  it("un campo de contraseña o de archivo pasa a texto", () => {
    const out = clean(`<input type="password"><input type="file">`).html;
    expect(out).not.toContain("password");
    expect(out).not.toContain("file");
  });

  it("un iframe de YouTube pasa a una imagen con el link", () => {
    const r = clean(`<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe>`);
    expect(r.html).toContain(`href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"`);
    expect(r.html).toContain(`src="https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"`);
    expect(r.html).not.toContain("<iframe");
    expect(r.removed).toMatchObject({ videos: 1, iframes: 0 });
  });

  it("un iframe de Vimeo pasa a un bloque con el link", () => {
    const r = clean(`<iframe src="https://player.vimeo.com/video/123456789"></iframe>`);
    expect(r.html).toContain(`href="https://vimeo.com/123456789"`);
    expect(r.html).not.toContain("<iframe");
    expect(r.removed.videos).toBe(1);
  });

  it("un iframe que dice ser YouTube pero apunta a otro lado se quita", () => {
    const r = clean(`<iframe src="https://youtube.evil.example/embed/dQw4w9WgXcQ"></iframe><iframe src="http://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>`);
    expect(r.html).toBe("");
    expect(r.removed).toMatchObject({ iframes: 2, videos: 0 });
  });
});

describe("el aviso de lo que se quitó", () => {
  it("cuenta scripts, formularios, marcos y otros", () => {
    const r = clean(`<script>a()</script><script>b()</script><script src="x.js"></script><form><input></form><iframe src="https://x.test"></iframe><object data="x"></object><p onclick="x()">a</p>`);
    expect(r.removed).toMatchObject({ scripts: 3, forms: 1, iframes: 1, other: 2 });
    expect(removedSummary(r.removed)).toBe("Se quitaron 3 scripts, 1 marco incrustado, 1 formulario y 2 elementos no permitidos: se mantiene el diseño.");
  });

  it("el ejemplo del plano", () => {
    expect(removedSummary({ scripts: 3, iframes: 0, forms: 1, other: 0, videos: 0 })).toBe("Se quitaron 3 scripts y 1 formulario: se mantiene el diseño.");
  });

  it("sin nada que quitar no hay aviso", () => {
    expect(removedSummary(clean(`<p>limpio</p>`).removed)).toBeNull();
  });

  it("avisa de los videos que pasaron a una imagen", () => {
    expect(removedSummary({ scripts: 0, iframes: 0, forms: 0, other: 0, videos: 2 })).toBe("2 videos de YouTube o Vimeo pasaron a una imagen con su link.");
  });
});
