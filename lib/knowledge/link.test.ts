import { describe, expect, it, vi } from "vitest";
import { fetchLinkAsMarkdown, htmlTitle, htmlToMarkdown, normalizeLinkUrl } from "./link";

/** : un enlace como documento. Sin red: `fetch` y la comprobación de IP se simulan. */

const publicCheck = async (url: string) => new URL(url);

function fakeFetch(body: string, contentType = "text/html; charset=utf-8", status = 200) {
  return vi.fn(async () => new Response(body, { status, headers: { "content-type": contentType } }));
}

describe("normalizeLinkUrl", () => {
  it("acepta http y https y agrega https si falta", () => {
    expect(normalizeLinkUrl("ejemplo.com/precios")).toEqual({ ok: true, url: "https://ejemplo.com/precios" });
    expect(normalizeLinkUrl("http://ejemplo.com/a#seccion")).toEqual({ ok: true, url: "http://ejemplo.com/a" });
  });

  it("rechaza otros protocolos, vacíos y con usuario", () => {
    expect(normalizeLinkUrl("").ok).toBe(false);
    expect(normalizeLinkUrl("ftp://ejemplo.com").ok).toBe(false);
    expect(normalizeLinkUrl("javascript:alert(1)").ok).toBe(false);
    expect(normalizeLinkUrl("https://user:pass@ejemplo.com").ok).toBe(false);
    expect(normalizeLinkUrl(`https://e.com/${"a".repeat(2100)}`).ok).toBe(false);
  });
});

describe("htmlToMarkdown", () => {
  it("conserva títulos, párrafos y listas y quita scripts, estilos y navegación", () => {
    const md = htmlToMarkdown(`<html><head><style>.x{}</style></head><body>
      <nav>Menú</nav><h1>Precios</h1><p>El plan cuesta <b>100&nbsp;€</b>.</p>
      <ul><li>Uno</li><li>Dos</li></ul><script>alert(1)</script><footer>Pie</footer></body></html>`);
    expect(md).toContain("# Precios");
    expect(md).toContain("El plan cuesta 100 €.");
    expect(md).toContain("- Uno");
    expect(md).toContain("- Dos");
    expect(md).not.toMatch(/Menú|alert|Pie|\.x\{\}/);
  });

  it("decodifica entidades y no deja líneas en blanco repetidas", () => {
    const md = htmlToMarkdown("<p>A &amp; B &#233; &#x41;</p><p></p><p></p><p>C</p>");
    expect(md).toBe("A & B é A\n\nC");
  });

  it("lee el título", () => {
    expect(htmlTitle("<title> Hola &amp; adiós </title>")).toBe("Hola & adiós");
    expect(htmlTitle("<p>sin</p>")).toBeNull();
  });
});

describe("fetchLinkAsMarkdown", () => {
  it("lee una página HTML con su título", async () => {
    const result = await fetchLinkAsMarkdown("https://ejemplo.com", { fetchImpl: fakeFetch("<title>FAQ</title><body><p>Respuesta</p></body>"), checkUrl: publicCheck });
    expect(result).toMatchObject({ ok: true, title: "FAQ", markdown: "Respuesta" });
  });

  it("acepta texto plano", async () => {
    const result = await fetchLinkAsMarkdown("https://ejemplo.com/a.txt", { fetchImpl: fakeFetch("hola", "text/plain"), checkUrl: publicCheck });
    expect(result).toMatchObject({ ok: true, markdown: "hola", title: null });
  });

  it("rechaza un PDF, una página sin texto y un error del servidor", async () => {
    expect((await fetchLinkAsMarkdown("https://e.com/x.pdf", { fetchImpl: fakeFetch("%PDF", "application/pdf"), checkUrl: publicCheck })).ok).toBe(false);
    expect((await fetchLinkAsMarkdown("https://e.com", { fetchImpl: fakeFetch("<body><script>x</script></body>"), checkUrl: publicCheck })).ok).toBe(false);
    const notFound = await fetchLinkAsMarkdown("https://e.com", { fetchImpl: fakeFetch("no", "text/html", 404), checkUrl: publicCheck });
    expect(notFound).toEqual({ ok: false, error: "La página respondió con un error (404)." });
  });

  it("una dirección privada no se lee", async () => {
    const fetchImpl = fakeFetch("secreto");
    const result = await fetchLinkAsMarkdown("http://127.0.0.1/admin", { fetchImpl });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
