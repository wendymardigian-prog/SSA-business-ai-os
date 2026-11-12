import { describe, expect, it } from "vitest";
import type { DesignDoc, DesignElement, DesignPage } from "../doc/schema";
import { backgroundLayers, cssText, EDIT_CSP, elementStyle, renderPageHTML, renderText, stripActiveContent, stripActiveCss, toReactStyle } from "./page-html";

const assetUrl = (p: string) => `https://storage.test/firmado/${p}`;
const text = (id: string, extra: Partial<Extract<DesignElement, { type: "text" }>> = {}): DesignElement => ({
  id,
  type: "text",
  x: 50,
  y: 50,
  w: 80,
  text: "Hola",
  font: { family: "Inter", weight: 700 },
  size: 48,
  align: "center",
  color: "#111111",
  ...extra,
});
const doc = (elements: DesignElement[], page: Partial<DesignPage> = {}, format: DesignDoc["format"] = "v45"): DesignDoc => ({
  v: 1,
  format,
  pages: [{ id: "pg_aaaa01", background: { type: "color", color: "#ffffff" }, elements, ...page }],
});

const SAMPLES: DesignElement[] = [
  text("el_a00001"),
  text("el_a00002", { rotation: 15, opacity: 0.5, transform: "uppercase", shadow: true, letterSpacing: 2, lineHeight: 1.4 }),
  text("el_a00003", { font: { family: "Playfair Display", weight: 400, italic: true }, align: "justify" }),
  text("el_a00004", { highlight: { color: "#ffff00", opacity: 0.6 } }),
  { id: "el_b00001", type: "image", x: 30, y: 30, w: 40, h: 30, asset: "ws/a.png", fit: "cover" },
  { id: "el_b00002", type: "image", x: 70, y: 70, w: 20, h: 20, asset: "ws/b.jpg", fit: "contain", radius: 24, rotation: -30 },
  { id: "el_c00001", type: "shape", x: 50, y: 90, w: 100, h: 10, shape: "rect", fill: "#000000" },
  { id: "el_c00002", type: "shape", x: 20, y: 20, w: 10, h: 10, shape: "circle", fill: "#ff0000", stroke: { color: "#ffffff", width: 4 } },
  { id: "el_c00003", type: "shape", x: 50, y: 50, w: 60, shape: "line", stroke: { color: "#00ff00", width: 3 } },
  { id: "el_d00001", type: "html", x: 50, y: 50, w: 100, h: 100, html: "<section><h1 data-tx=\"t1\">Título</h1></section>", css: "h1{color:red}" },
];

describe("renderPageHTML (F10)", () => {
  it("nunca devuelve <script, on…= ni javascript:, aunque el HTML de adentro los traiga", () => {
    const evil: DesignElement = {
      id: "el_e00001",
      type: "html",
      x: 50,
      y: 50,
      w: 100,
      h: 100,
      html: '<script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a><iframe srcdoc="<script>1</script>"></iframe><svg onload=alert(1)><scr<script>ipt>alert(1)</script>',
      css: "body{background:url(javascript:alert(1))} </style><script>alert(1)</script>",
    };
    const html = renderPageHTML(doc([evil, text("el_e00002", { text: "<script>alert(1)</script>" })]), 0, { mode: "public", assetUrl });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/[\s/"']on[a-z]+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  it("tampoco con los disfraces conocidos (barra en vez de espacio, entidades en el esquema)", () => {
    const attacks = [
      "<img/onerror=alert(1) src=x>",
      "<svg/onload=alert(1)>",
      '<a href="jav&#x61;script:alert(1)">x</a>',
      '<a href="jav&#97;script:alert(1)">x</a>',
      '<a href="javascript&colon;alert(1)">x</a>',
      '<a href=" &#14; javascript:alert(1)">x</a>',
      '<img src="data:text/html;base64,PHNjcmlwdD4=">',
      '<a href="vbscript:msgbox(1)">x</a>',
      '<div style="background:url(javascript:alert(1))">x</div>',
      '<img src=x onerror\n=alert(1)>',
      '<a xlink:href="javascript:alert(1)">x</a>',
      '<form action="javascript:alert(1)"><button>x</button></form>',
      "<iframe srcdoc='<script>alert(1)</script>'></iframe>",
    ];
    for (const attack of attacks) {
      const out = stripActiveContent(attack);
      expect(out, attack).not.toMatch(/<script|[\s/"']on[a-z]+\s*=|javascript|vbscript|data:text\/html|&#x61;script|&#97;script|&colon;/i);
    }
    // Lo seguro queda.
    expect(stripActiveContent('<a href="https://ejemplo.test/x">ok</a><img src="asset:ws/a.png">')).toBe('<a href="https://ejemplo.test/x">ok</a><img src="asset:ws/a.png">');
  });

  it("un texto con <b> escrito por la persona sale escapado", () => {
    const html = renderPageHTML(doc([text("el_f00001", { text: "Hola <b>mundo</b>" })]), 0, { mode: "public", assetUrl });
    expect(html).toContain("Hola &lt;b&gt;mundo&lt;/b&gt;");
    expect(html).not.toContain("<b>mundo");
  });

  it("el z-index sigue el orden del arreglo (el último adelante)", () => {
    const html = renderPageHTML(doc([text("el_g00001"), text("el_g00002"), text("el_g00003")]), 0, { mode: "export", assetUrl });
    const order = [...html.matchAll(/data-el="(el_g0000\d)"[^>]*z-index: (\d+)/g)].map((m) => [m[1], Number(m[2])]);
    expect(order).toEqual([
      ["el_g00001", 1],
      ["el_g00002", 2],
      ["el_g00003", 3],
    ]);
  });

  it("un oculto no sale en public ni en export; en edit se ve tenue si se pide", () => {
    const d = doc([text("el_h00001", { hidden: true }), text("el_h00002")]);
    expect(renderPageHTML(d, 0, { mode: "public", assetUrl })).not.toContain("el_h00001");
    expect(renderPageHTML(d, 0, { mode: "export", assetUrl })).not.toContain("el_h00001");
    expect(renderPageHTML(d, 0, { mode: "edit", assetUrl, showHidden: true })).toMatch(/el_h00001[^>]*opacity: 0.25/);
  });

  it("reemplaza las variables con sus valores; sin valor, vacía en public y chip en edit", () => {
    const d = doc([text("el_i00001", { text: "Se otorga a {{contact.display_name}} · {{design.code}}" })]);
    const pub = renderPageHTML(d, 0, { mode: "public", assetUrl, values: { "contact.display_name": "Ana <Pérez>" } });
    expect(pub).toContain("Se otorga a Ana &lt;Pérez&gt; · ");
    const edit = renderPageHTML(d, 0, { mode: "edit", assetUrl, variableLabel: (k) => (k === "design.code" ? "Código de verificación" : k) });
    expect(edit).toContain('<span class="dz-var" data-var="design.code">Código de verificación</span>');
  });

  it("los archivos se cargan con la URL que da el servidor, también los del HTML cargado", () => {
    const d = doc(
      [
        { id: "el_j00001", type: "image", x: 50, y: 50, w: 50, h: 50, asset: "ws/foto.png", fit: "cover" },
        { id: "el_j00002", type: "html", x: 50, y: 50, w: 100, h: 100, html: '<img src="asset:ws/imports/x/logo.png">', css: ".a{background:url(asset:ws/imports/x/bg.jpg)}" },
      ],
      { background: { type: "image", image: { asset: "ws/fondo.jpg", fit: "cover", focal: { x: 30, y: 60 }, locked: true } } },
    );
    const html = renderPageHTML(d, 0, { mode: "export", assetUrl });
    expect(html).toContain("https://storage.test/firmado/ws/foto.png");
    expect(html).toContain("https://storage.test/firmado/ws/imports/x/logo.png");
    expect(html).toContain("https://storage.test/firmado/ws/imports/x/bg.jpg");
    expect(html).toContain("https://storage.test/firmado/ws/fondo.jpg");
    expect(html).not.toContain("asset:");
  });

  it("pide a Google las fuentes usadas en una sola URL y no pide las subidas", () => {
    const d = doc([text("el_k00001"), text("el_k00002", { font: { family: "Mi Marca", weight: 400 } })]);
    const html = renderPageHTML(d, 0, { mode: "export", assetUrl, uploadedFonts: [{ family: "Mi Marca", weight: 400, style: "normal", path: "ws/fonts/m.woff2", format: "woff2" }] });
    expect(html).toContain("https://fonts.googleapis.com/css2?family=Inter:wght@700&amp;display=swap");
    expect(html).toContain('@font-face{font-family:"Mi Marca"');
  });

  it("la página mide lo del formato; una web publicada es fluida y tiene su punto de quiebre", () => {
    expect(renderPageHTML(doc([]), 0, { mode: "export", assetUrl })).toContain("width: 1080px; height: 1350px");
    const web = renderPageHTML(doc([], { height: 3000 }, "web"), 0, { mode: "public", assetUrl });
    expect(web).toContain("max-width: 1280px; min-height: 3000px");
    expect(web).toContain("@media (max-width: 640px)");
  });

  it("una página que no existe lanza", () => {
    expect(() => renderPageHTML(doc([]), 3, { mode: "export", assetUrl })).toThrow(/página 4/);
  });
});

describe("paridad: el lienzo y el render usan el mismo estilo", () => {
  it("elementStyle produce exactamente el CSS que escribe renderPageHTML (10 elementos)", () => {
    expect(SAMPLES).toHaveLength(10);
    const html = renderPageHTML(doc(SAMPLES), 0, { mode: "export", assetUrl });
    SAMPLES.forEach((el, i) => {
      const match = html.match(new RegExp(`data-el="${el.id}" data-el-type="${el.type}"(?: class="dz-flow")? style="([^"]*)"`));
      expect(match, el.id).not.toBeNull();
      const attr = match![1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      expect(attr).toBe(cssText(elementStyle(el, i + 1)));
    });
  });

  it("toReactStyle pasa a camelCase", () => {
    expect(toReactStyle({ "z-index": "2", "font-family": '"Inter"', "-webkit-box-decoration-break": "clone" })).toEqual({
      zIndex: "2",
      fontFamily: '"Inter"',
      WebkitBoxDecorationBreak: "clone",
    });
  });
});

describe("fondo (backgroundLayers)", () => {
  it("ordena: color o degradé, imagen, capa de color", () => {
    const layers = backgroundLayers({
      id: "pg_x00001",
      elements: [],
      background: { type: "image", image: { asset: "ws/f.jpg", fit: "contain", focal: { x: 50, y: 50 }, locked: false }, overlay: { color: "#000000", opacity: 0.4 } },
    });
    expect(layers.map((l) => l.kind)).toEqual(["base", "image", "overlay"]);
    expect(layers[1].style["background-size"]).toBe("contain");
  });

  it("la capa de color fuera de rango se corrige al límite", () => {
    const layers = backgroundLayers({ id: "pg_x00002", elements: [], background: { type: "color", color: "#ffffff", overlay: { color: "#000000", opacity: 3 } } });
    expect(layers.at(-1)!.style.background).toBe("rgba(0, 0, 0, 0.9)");
  });

  it("degradé con su ángulo", () => {
    const [base] = backgroundLayers({ id: "pg_x00003", elements: [], background: { type: "gradient", gradient: { from: "#000000", to: "#ffffff", angle: 135 } } });
    expect(base.style.background).toBe("linear-gradient(135deg, #000000, #ffffff)");
  });
});

describe("el render del editor prohíbe código adentro del iframe", () => {
  it("solo en modo edit lleva la política que bloquea scripts", () => {
    const d = doc(SAMPLES);
    const edit = renderPageHTML(d, 0, { mode: "edit", assetUrl });
    expect(edit).toContain(`<meta http-equiv="Content-Security-Policy" content="${EDIT_CSP}">`);
    expect(EDIT_CSP).toContain("script-src 'none'");
    for (const mode of ["public", "export"] as const) expect(renderPageHTML(d, 0, { mode, assetUrl })).not.toContain("Content-Security-Policy");
  });

  it("conserva las marcas de los textos cargados (las usa el lienzo para ubicarlos)", () => {
    expect(renderPageHTML(doc(SAMPLES), 0, { mode: "edit", assetUrl })).toContain('data-tx="t1"');
  });
});

describe("limpieza defensiva", () => {
  it("saca lo ejecutable y deja el diseño", () => {
    expect(stripActiveContent('<div class="a" onclick="x()">Hola</div><script>x</script>')).toBe('<div class="a">Hola</div>');
    expect(stripActiveCss("@import url(https://evil.test/a.css); @import url(https://fonts.googleapis.com/css2?family=Inter); a{b:expression(1)}")).toBe(
      " @import url(https://fonts.googleapis.com/css2?family=Inter); a{b:(1)}",
    );
  });
  it("renderText no interpreta nada que no sea una variable", () => {
    expect(renderText("{{ no es variable }} & {{contact.email}}", { mode: "export", values: { "contact.email": "a@b.c" } })).toBe("{{ no es variable }} &amp; a@b.c");
  });

  it("no toca el texto que ve la persona (solo limpia dentro de las etiquetas)", () => {
    expect(stripActiveContent('<p>Texto "one=2" y javascript: en una frase</p>')).toBe('<p>Texto "one=2" y javascript: en una frase</p>');
  });
});

describe("los @import de Google Fonts de una página cargada van primero", () => {
  it("quedan al principio de la hoja y los externos se quitan", () => {
    const el: DesignElement = {
      id: "el_e00001",
      type: "html",
      x: 50,
      y: 50,
      w: 100,
      h: 100,
      html: "<h1>Hola</h1>",
      css: 'h1{color:red}\n@import url(https://fonts.googleapis.com/css2?family=Inter&display=swap);\n@import url("https://evil.example/x.css");\np{margin:0}',
    };
    const html = renderPageHTML(doc([el]), 0, { mode: "public", assetUrl });
    const sheet = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
    expect(sheet.startsWith("@import url(https://fonts.googleapis.com/css2?family=Inter&display=swap);")).toBe(true);
    expect(sheet).not.toContain("evil.example");
    expect(sheet.match(/@import/g)).toHaveLength(1);
    expect(sheet).toContain("h1{color:red}");
    expect(sheet).toContain("p{margin:0}");
  });
});
