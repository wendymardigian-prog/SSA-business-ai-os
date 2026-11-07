import { describe, expect, it } from "vitest";
import {
  dropDanglingComma,
  escapeHtml,
  finalizeEmailHtml,
  inlineEmailStyles,
  interpolateHtml,
  isHtmlTemplate,
  plainTextToHtml,
  sanitizeEmailHtml,
  withPreheader,
} from "@/lib/email/html";
import { brandedEmailHtml } from "@/lib/email/templates";

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
  it("un link en texto plano sale como link, con su estilo", () => {
    const out = plainTextToHtml("Mirá https://a.com/x?y=1&z=2.");
    expect(out).toContain('<a href="https://a.com/x?y=1&amp;z=2" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">https://a.com/x?y=1&amp;z=2</a>.');
  });

  it("una etiqueta metida en el texto sigue escapada aunque haya un link al lado", () => {
    const out = plainTextToHtml('<a href="https://malo.com">x</a> https://a.com');
    expect(out).toContain("&lt;a href=");
    // La URL de adentro se ve tal cual y lleva a donde dice; nunca se esconde atras de otro texto.
    expect(out).not.toContain(">x</a>");
    expect(out).toContain('<a href="https://a.com"');
  });

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

describe("withPreheader", () => {
  it("sin preheader devuelve lo mismo, byte por byte", () => {
    const html = finalizeEmailHtml("<p>Hola</p>", true);
    for (const empty of [null, undefined, "", "   ", "\n"]) expect(withPreheader(html, empty)).toBe(html);
  });

  it("lo pone oculto delante del cuerpo, escapado y en una sola linea", () => {
    const html = withPreheader("<div>cuerpo</div>", " Lunes 9,\n7 PM <b>ya</b> ");
    expect(html.startsWith('<div style="display:none;')).toBe(true);
    expect(html).toContain("Lunes 9, 7 PM &lt;b&gt;ya&lt;/b&gt;</div><div>cuerpo</div>");
  });

  it("es el mismo oculto que usan los emails del sistema", () => {
    const line = withPreheader("", "Falta entrar al grupo");
    expect(brandedEmailHtml({ body: "<p>x</p>", preheader: "Falta entrar al grupo" })).toContain(line);
  });
});

describe("dropDanglingComma", () => {
  const template = "Hola, {{contact.first_name|}}.";

  it("sin nombre queda «Hola.»; con nombre, igual", () => {
    expect(dropDanglingComma(template, "Hola, .")).toBe("Hola.");
    expect(dropDanglingComma(template, "Hola, Ana.")).toBe("Hola, Ana.");
  });

  it("en HTML ya limpio, incluso si el editor envolvio la variable", () => {
    const wrapped = '<p>Hola, <span data-variable="contact.first_name">{{contact.first_name|}}</span>.</p>';
    const rendered = finalizeEmailHtml('<p>Hola, <span data-variable="contact.first_name"></span>.</p>', true);
    expect(dropDanglingComma(wrapped, rendered)).toContain(">Hola.</p>");
    expect(dropDanglingComma("<p>Hola, {{contact.first_name|}}.</p>", finalizeEmailHtml("<p>Hola,&nbsp;.</p>", true))).toContain(">Hola.</p>");
  });

  it("no toca los estilos en linea ni los links del email", () => {
    const html = finalizeEmailHtml('<p>Hola, Ana.</p><p><a href="https://x.com/a,b">x</a></p>', true);
    expect(dropDanglingComma(template, html)).toBe(html);
  });

  it("una plantilla sin respaldo vacio queda exactamente como se escribio", () => {
    for (const other of ["Hola, {{contact.first_name}}.", "Hola, {{contact.first_name|amiga}}.", "Hola, ."]) {
      expect(dropDanglingComma(other, "Hola, .")).toBe("Hola, .");
    }
  });
});
