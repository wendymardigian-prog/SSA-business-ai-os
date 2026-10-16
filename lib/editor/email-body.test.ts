import { describe, expect, it } from "vitest";
import { bodyToEditorHtml, editorHtmlToBody, normalizeLink, variableToken } from "@/lib/editor/email-body";

describe("bodyToEditorHtml", () => {
  it("un texto plano viejo se abre como parrafos y respeta los saltos", () => {
    expect(bodyToEditorHtml("Hola\nque tal\n\nChau")).toBe("<p>Hola<br>que tal</p><p>Chau</p>");
  });

  it("escapa lo que parece una etiqueta en un texto plano", () => {
    expect(bodyToEditorHtml("2 < 3 y <algo>")).toBe("<p>2 &lt; 3 y &lt;algo&gt;</p>");
  });

  it("un HTML guardado se devuelve tal cual", () => {
    const html = "<h2>Hola</h2><p>x</p>";
    expect(bodyToEditorHtml(html)).toBe(html);
  });

  it("vacio es vacio", () => {
    expect(bodyToEditorHtml("")).toBe("");
    expect(bodyToEditorHtml("   \n")).toBe("");
  });

  it("las variables y los emojis sobreviven", () => {
    expect(bodyToEditorHtml("Hola {{contact.first_name}} 😀")).toBe("<p>Hola {{contact.first_name}} 😀</p>");
  });
});

describe("editorHtmlToBody", () => {
  it("un documento vacio se guarda como cadena vacia", () => {
    expect(editorHtmlToBody("<p></p>")).toBe("");
    expect(editorHtmlToBody("<p><br></p>")).toBe("");
    expect(editorHtmlToBody("<p>&nbsp;</p>")).toBe("");
  });

  it("una variable sola cuenta como contenido", () => {
    const html = '<p><span data-variable="contact.first_name">{{contact.first_name}}</span></p>';
    expect(editorHtmlToBody(html)).toBe(html);
  });

  it("el texto con formato se guarda tal cual", () => {
    expect(editorHtmlToBody("<p>Hola <strong>mundo</strong></p>")).toBe("<p>Hola <strong>mundo</strong></p>");
  });
});

describe("variableToken y normalizeLink", () => {
  it("variableToken", () => expect(variableToken("a.b")).toBe("{{a.b}}"));

  it("completa lo que falta de un enlace y rechaza lo que no es un enlace", () => {
    expect(normalizeLink("https://x.com/a")).toBe("https://x.com/a");
    expect(normalizeLink("x.com/a")).toBe("https://x.com/a");
    expect(normalizeLink("ana@x.com")).toBe("mailto:ana@x.com");
    expect(normalizeLink("tel:+5491122")).toBe("tel:+5491122");
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("hola")).toBeNull();
    expect(normalizeLink("")).toBeNull();
  });
});
