import { describe, expect, it } from "vitest";
import { parseLinkPreview } from "./parse";

const page = "https://www.ejemplo.com/notas/uno";

describe("parseLinkPreview", () => {
  it("lee og:, en cualquier orden de atributos y con entidades", () => {
    const html = `<html><head>
      <meta content="Café &amp; más" property="og:title">
      <meta property='og:description' content='Una &#233;poca &quot;buena&quot;'>
      <meta property="og:image" content="/img/a.png">
      <meta property="og:site_name" content="Ejemplo">
      <title>Otro título</title></head><body></body></html>`;
    expect(parseLinkPreview(html, page)).toEqual({
      title: "Café & más",
      description: 'Una época "buena"',
      image: "https://www.ejemplo.com/img/a.png",
      siteName: "Ejemplo",
    });
  });

  it("sin og: usa twitter:, y sin eso el <title> y la description", () => {
    expect(parseLinkPreview('<meta name="twitter:title" content="T"><meta name="twitter:image" content="https://cdn.com/a.jpg">', page)).toMatchObject({ title: "T", image: "https://cdn.com/a.jpg" });
    expect(parseLinkPreview('<head><title>\n  Hola\n  mundo </title><meta name="description" content="D"></head>', page)).toEqual({
      title: "Hola mundo",
      description: "D",
      image: null,
      siteName: "ejemplo.com",
    });
  });

  it("sin titulo no hay tarjeta", () => {
    expect(parseLinkPreview('<meta property="og:description" content="D">', page)).toBeNull();
    expect(parseLinkPreview("<title>   </title>", page)).toBeNull();
    expect(parseLinkPreview("", page)).toBeNull();
    expect(parseLinkPreview("PDF binario", page)).toBeNull();
  });

  it("una imagen que no es https no vale", () => {
    for (const src of ["http://a.com/x.png", "data:image/png;base64,AAAA", "javascript:alert(1)"]) {
      expect(parseLinkPreview(`<title>T</title><meta property="og:image" content="${src}">`, page)?.image).toBeNull();
    }
  });

  it("no lee el cuerpo de la pagina: un meta o un title ahi no cuentan", () => {
    expect(parseLinkPreview('<head><title>Bien</title></head><body><meta property="og:title" content="Inyectado"></body>', page)?.title).toBe("Bien");
  });

  it("no ejecuta ni deja pasar etiquetas como dato especial: el texto queda como texto", () => {
    expect(parseLinkPreview('<meta property="og:title" content="&lt;script&gt;x&lt;/script&gt;">', page)?.title).toBe("<script>x</script>");
  });

  it("corta lo largo sin partir un emoji", () => {
    const preview = parseLinkPreview(`<title>${"😀".repeat(200)}</title>`, page);
    expect(Array.from(preview?.title ?? "")).toHaveLength(120);
    expect(preview?.title.endsWith("…")).toBe(true);
  });

  it("una entidad invalida no rompe nada", () => {
    expect(parseLinkPreview("<title>a &#xFFFFFFFF; b &raro; c</title>", page)?.title).toBe("a &#xFFFFFFFF; b &raro; c");
  });
});
