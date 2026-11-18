// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { communityEmailHtml, communityEmailPreheader, communityPhotoLine } from "./community-email";

const ink = "#4f46e5";

describe("communityEmailHtml", () => {
  it("títulos, negrita, cursiva, listas y párrafos", () => {
    const html = communityEmailHtml("## Tus pasos\n\nEsto es **clave** y *esto* también.\n\n- uno\n- dos\n\n1. tres", { ink });
    expect(html).toContain("font-weight:700;color:#111827;\">Tus pasos</p>");
    expect(html).toContain("<strong>clave</strong>");
    expect(html).toContain("<em>esto</em>");
    expect(html).toMatch(/<ul [^>]*><li [^>]*>uno<\/li><li [^>]*>dos<\/li><\/ul>/);
    expect(html).toMatch(/<ol [^>]*><li [^>]*>tres<\/li><\/ol>/);
  });

  it("escapa el HTML que alguien escribe", () => {
    const html = communityEmailHtml('Hola <script>alert("x")</script> & <b>chau</b>', { ink });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;b&gt;chau&lt;/b&gt;");
  });

  it("un link javascript: no es link", () => {
    const html = communityEmailHtml("[clic](javascript:alert(1))", { ink });
    expect(html).not.toContain("href=\"javascript");
  });

  it("links con texto y links sueltos, con el color de marca", () => {
    const html = communityEmailHtml("Mirá [el portal](https://ejemplo.com/a) y https://youtu.be/abc123", { ink });
    expect(html).toContain(`<a href="https://ejemplo.com/a" target="_blank" style="color:${ink};`);
    expect(html).toContain(`<a href="https://youtu.be/abc123"`);
  });

  it("los saltos de línea sueltos quedan como <br />", () => {
    expect(communityEmailHtml("Línea uno\nLínea dos", { ink })).toContain("Línea uno<br />Línea dos");
  });

  it("los emojis pasan tal cual", () => {
    expect(communityEmailHtml("Hola 🙌 📌", { ink })).toContain("Hola 🙌 📌");
  });

  it("un cuerpo vacío no arma nada", () => {
    expect(communityEmailHtml("", { ink })).toBe("");
  });
});

describe("communityEmailPreheader", () => {
  it("texto plano, sin marcas", () => {
    expect(communityEmailPreheader("## Hola\n\n**Bienvenidos** a la comunidad")).toBe("Hola Bienvenidos a la comunidad");
  });
  it("corta en una palabra con «…»", () => {
    const out = communityEmailPreheader("palabra ".repeat(40), 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("palabra…")).toBe(true);
  });
});

describe("communityPhotoLine", () => {
  it("singular, plural y nada", () => {
    expect(communityPhotoLine(0)).toBeNull();
    expect(communityPhotoLine(1)).toBe("Esta publicación tiene 1 foto.");
    expect(communityPhotoLine(3)).toBe("Esta publicación tiene 3 fotos.");
  });
});
