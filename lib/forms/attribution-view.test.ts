import { describe, it, expect } from "vitest";
import { attributionSections, bestEntryUrl } from "./attribution-view";

describe("attributionSections", () => {
  it("agrupa y ordena: campaña, anuncio, navegador y páginas", () => {
    const sections = attributionSections({
      utm_source: "facebook",
      utm_campaign: "octubre",
      fbclid: "abc",
      ad_id: "123",
      fbp: "fb.1.2.3",
      landing_page: "https://s.test/promo",
    });
    expect(sections.map((s) => s.title)).toEqual(["Campaña", "Anuncio", "Navegador", "Páginas"]);
    expect(sections[0].items.map((i) => i.key)).toEqual(["utm_source", "utm_campaign"]);
    expect(sections[1].items.map((i) => i.key)).toEqual(["fbclid", "ad_id"]);
  });

  it("sin datos no hay secciones", () => {
    expect(attributionSections({})).toEqual([]);
    expect(attributionSections(null)).toEqual([]);
  });

  it("la primera visita solo aparece si es distinta de la actual", () => {
    const same = attributionSections({ utm_campaign: "octubre", first_visit: { utm_campaign: "octubre", ts: 1 } });
    expect(same.map((s) => s.title)).toEqual(["Campaña"]);
    const diff = attributionSections({ utm_campaign: "noviembre", first_visit: { utm_campaign: "octubre", gclid: "g1", ts: 1 } });
    const first = diff.find((s) => s.title === "Primera visita");
    expect(first?.items.map((i) => i.key)).toEqual(["utm_campaign", "gclid"]);
  });

  it("ignora valores que no son texto", () => {
    expect(attributionSections({ utm_source: 5, utm_medium: "", utm_term: "x" }).flatMap((s) => s.items.map((i) => i.key))).toEqual(["utm_term"]);
  });
});

describe("bestEntryUrl", () => {
  it("usa entry_url si está", () => {
    expect(bestEntryUrl({ entry_url: "https://s.test/a?ref=x", landing_page: "https://s.test/b" })).toBe("https://s.test/a?ref=x");
  });

  it("si no está, usa la página de llegada sin parámetros sensibles", () => {
    expect(bestEntryUrl({ landing_page: "https://s.test/b?utm_source=meta&token=secreto" })).toBe("https://s.test/b?utm_source=meta");
  });

  it("sin ninguna de las dos, o con algo que no es una URL, no devuelve nada", () => {
    expect(bestEntryUrl({})).toBeNull();
    expect(bestEntryUrl(null)).toBeNull();
    expect(bestEntryUrl({ landing_page: "javascript:alert(1)" })).toBeNull();
  });
});
