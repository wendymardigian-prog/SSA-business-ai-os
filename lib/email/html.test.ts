import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  finalizeEmailHtml,
  inlineEmailStyles,
  interpolateHtml,
  isHtmlTemplate,
  plainTextToHtml,
  sanitizeEmailHtml,
} from "@/lib/email/html";

describe("isHtmlTemplate", () => {
  it("reconoce el HTML del editor y no confunde texto plano", () => {
    expect(isHtmlTemplate("<p>Hola {{contact.first_name}}</p>")).toBe(true);
    expect(isHtmlTemplate("Hola\n\nChau")).toBe(false);
    expect(isHtmlTemplate("a < b y c > d")).toBe(false);
    expect(isHtmlTemplate("2 <3 amor")).toBe(false);
  });
});

describe("interpolateHtml: los valores se escapan", () => {
  it("un nombre con HTML queda como texto", () => {
    const out = interpolateHtml("<p>Hola {{contact.name}}</p>", { contact: { name: '<a href="https://malo.com">x</a>' } });
    expect(out).toBe("<p>Hola &lt;a href=&quot;https://malo.com&quot;&gt;x&lt;/a&gt;</p>");
  });

  it("un token sin valor queda tal cual (se ve que falto configurar algo)", () => {
    expect(interpolateHtml("<p>{{nada.aca}}</p>", {})).toBe("<p>{{nada.aca}}</p>");
  });

  it("los emojis pasan intactos", () => {
    expect(interpolateHtml("<p>{{x}}</p>", { x: "Hola 😀 👨‍👩‍👧 ❤️" })).toBe("<p>Hola 😀 👨‍👩‍👧 ❤️</p>");
  });
});

describe("sanitizeEmailHtml", () => {
  it("deja el formato que el editor produce", () => {
    const html = "<h2>Hola</h2><p>Esto es <strong>negrita</strong>, <em>cursiva</em> y <u>subrayado</u>.</p><ul><li>uno</li><li>dos</li></ul><ol><li>a</li></ol>";
    expect(sanitizeEmailHtml(html)).toBe(html);
  });

  it("saca script, style y sus contenidos", () => {
    const out = sanitizeEmailHtml('<p>ok</p><script>alert(1)</script><style>p{x:y}</style><iframe src="x"></iframe><p>fin</p>');
    expect(out).toBe("<p>ok</p><p>fin</p>");
  });

  it("saca atributos de eventos y de estilo", () => {
    expect(sanitizeEmailHtml('<p onclick="x()" style="color:red" class="a">hola</p>')).toBe("<p>hola</p>");
  });

  it("los links: solo http, https, mailto y tel", () => {
    expect(sanitizeEmailHtml('<a href="https://x.com/a?b=1&amp;c=2">x</a>')).toBe('<a href="https://x.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">x</a>');
    expect(sanitizeEmailHtml('<a href="mailto:a@b.com">m</a>')).toContain('href="mailto:a@b.com"');
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeEmailHtml('<a href=" JaVaScRiPt:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeEmailHtml('<a href="jav&#x61;script:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeEmailHtml('<a href="data:text/html;base64,AAAA">x</a>')).toBe("<a>x</a>");
    expect(sanitizeEmailHtml('<a href="//evil.com">x</a>')).toBe("<a>x</a>");
  });

  it("un href con comillas no puede salirse del atributo", () => {
    const out = sanitizeEmailHtml(`<a href='https://x.com/" onmouseover="alert(1)'>x</a>`);
    expect(out).not.toMatch(/onmouseover=".*"\s/);
    expect(out).toContain("&quot;");
  });

  it("cierra lo que quedo abierto y descarta cierres huerfanos", () => {
    expect(sanitizeEmailHtml("<p><strong>hola")).toBe("<p><strong>hola</strong></p>");
    expect(sanitizeEmailHtml("hola</p></strong>")).toBe("hola");
  });

  it("un < suelto en el texto no abre nada", () => {
    expect(sanitizeEmailHtml("<p>2 < 3</p>")).toBe("<p>2 &lt; 3</p>");
  });

  it("una etiqueta desconocida se saca pero queda su texto", () => {
    expect(sanitizeEmailHtml("<div><span>hola</span><img src=x onerror=alert(1)></div>")).toBe("hola");
  });

  it("los comentarios se descartan", () => {
    expect(sanitizeEmailHtml("<p>a<!-- <script> -->b</p>")).toBe("<p>ab</p>");
  });

  it("conserva las variables sin resolver y los emojis", () => {
    expect(sanitizeEmailHtml("<p>Hola {{contact.first_name}} 😀</p>")).toBe("<p>Hola {{contact.first_name}} 😀</p>");
  });
});

describe("estilos en linea", () => {
  it("cada etiqueta con formato lleva su estilo y todo va dentro de un contenedor", () => {
    const out = inlineEmailStyles("<h1>T</h1><p>x</p><ul><li>a</li></ul>");
    expect(out).toMatch(/^<div style="font-family:/);
    expect(out).toContain('<h1 style="');
    expect(out).toContain('<p style="');
    expect(out).toContain('<li style="');
  });

  it("un link conserva su href al sumar el estilo", () => {
    const safe = sanitizeEmailHtml('<a href="https://x.com">x</a>');
    expect(inlineEmailStyles(safe)).toMatch(/<a href="https:\/\/x\.com" target="_blank" rel="noopener noreferrer" style="color:#2563eb/);
  });
});

describe("texto plano y finalizeEmailHtml", () => {
  it("el texto plano se escapa y respeta los saltos", () => {
    const out = plainTextToHtml("Hola <b>x</b>\nlinea\n\nOtro & otro");
    expect(out).toContain("Hola &lt;b&gt;x&lt;/b&gt;<br>linea");
    expect(out).toContain("Otro &amp; otro");
    expect(out).not.toContain("<b>");
  });

  it("un cuerpo HTML pasa por la lista blanca incluso con valores pegados", () => {
    const body = interpolateHtml("<p>Hola {{n}}</p>", { n: "<script>alert(1)</script>" });
    const out = finalizeEmailHtml(body, true);
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});
