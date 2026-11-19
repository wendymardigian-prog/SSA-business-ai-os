import { describe, expect, it } from "vitest";
import { appendCitations, citationLabel, groupCitations, pagesForChunks } from "./pages";
import { chunkMarkdown } from "./chunk";

describe("pagesForChunks", () => {
  it("sin marcas (texto, Markdown, Word, enlace): todas sin página", () => {
    expect(pagesForChunks(["hola", "chau"])).toEqual([null, null]);
  });

  it("un trozo que arranca con la marca toma esa página; uno sin marca sigue la anterior", () => {
    const chunks = ["<!-- pagina 1 -->\n\nIntro", "sigue la intro", "---\n\n<!-- pagina 2 -->\n\nPrecios", "texto <!-- pagina 3 --> más", "final"];
    expect(pagesForChunks(chunks)).toEqual([1, 1, 2, 2, 3]);
  });

  it("con el troceado real de un PDF de tres páginas, cada trozo cae en su página", () => {
    const page = (n: number) => `<!-- pagina ${n} -->\n\n${`Texto de la página ${n}. `.repeat(90)}`;
    const md = [page(1), page(2), page(3)].join("\n\n---\n\n");
    const chunks = chunkMarkdown(md).map((c) => c.content);
    const pages = pagesForChunks(chunks);
    expect(pages[0]).toBe(1);
    expect(pages[pages.length - 1]).toBe(3);
    expect(pages.every((p) => p !== null && p >= 1 && p <= 3)).toBe(true);
    // Nunca retrocede.
    for (let i = 1; i < pages.length; i++) expect(pages[i]!).toBeGreaterThanOrEqual(pages[i - 1]!);
  });
});

describe("citas", () => {
  it("la etiqueta lleva el documento y la página; sin página, solo el documento («sin dato» nunca es 0)", () => {
    expect(citationLabel("Tarifas 2026", [4])).toBe("«Tarifas 2026», pág. 4");
    expect(citationLabel("Tarifas 2026", [5, 2, 5])).toBe("«Tarifas 2026», págs. 2 y 5");
    expect(citationLabel("Preguntas frecuentes", [null])).toBe("«Preguntas frecuentes»");
  });

  it("agrupa por documento y corta en tres", () => {
    const c = [
      { document: "A", page: 1 },
      { document: "B", page: null },
      { document: "A", page: 3 },
      { document: "C", page: 2 },
      { document: "D", page: 9 },
    ];
    expect(groupCitations(c)).toEqual(["«A», págs. 1 y 3", "«B»", "«C», pág. 2"]);
  });

  it("si el modelo no citó, se agrega la línea «Fuente» al final de la última parte", () => {
    const out = appendCitations(["Hola.", "La cuota es 90 €."], [{ document: "Tarifas 2026", page: 4 }]);
    expect(out).toEqual(["Hola.", "La cuota es 90 €.\n\nFuente: «Tarifas 2026», pág. 4."]);
  });

  it("si el modelo ya citó documento y página, no se repite", () => {
    const parts = ["La cuota es 90 €.\n\nFuente: «Tarifas 2026», pág. 4"];
    expect(appendCitations(parts, [{ document: "Tarifas 2026", page: 4 }])).toBe(parts);
  });

  it("si nombró el documento sin la página, se agrega con la página", () => {
    const out = appendCitations(["Según Tarifas 2026, son 90 €."], [{ document: "Tarifas 2026", page: 4 }]);
    expect(out[0]).toContain("Fuente: «Tarifas 2026», pág. 4.");
  });

  it("sin citas, la respuesta queda igual", () => {
    const parts = ["Hola"];
    expect(appendCitations(parts, [])).toBe(parts);
  });
});
