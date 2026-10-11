import { describe, it, expect } from "vitest";
import { attributionSections } from "./attribution-view";

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
