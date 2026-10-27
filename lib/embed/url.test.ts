import { describe, it, expect } from "vitest";
import { buildEmbedIframeUrl, parentUtmFromSearch } from "./url";

describe("buildEmbedIframeUrl (F39)", () => {
  it("genera la URL del plano conservando los UTM de la página padre", () => {
    expect(buildEmbedIframeUrl("ana/llamada", { theme: "dark", color: "#aa00ff" }, { utm_source: "instagram" })).toBe(
      "/calendario/ana/llamada?embed=1&theme=dark&color=%23aa00ff&utm_source=instagram",
    );
  });

  it("brandColor es alias de color; un color que no es hex se ignora", () => {
    expect(buildEmbedIframeUrl("ana/llamada", { brandColor: "AA00FF" })).toBe("/calendario/ana/llamada?embed=1&color=%23aa00ff");
    expect(buildEmbedIframeUrl("ana/llamada", { brandColor: "rojo" })).toBe("/calendario/ana/llamada?embed=1");
  });

  it("precarga, zona, otras preguntas, referrer y origen absoluto", () => {
    const url = buildEmbedIframeUrl(
      "ana/llamada",
      { name: "Ana", email: "a@b.com", presupuesto: "1000", "Mal Nombre": "x", tz: "America/Costa_Rica", referrer: "https://mi-web.com/p", hideEventTypeDetails: true },
      { gclid: "g1" },
      "https://agenda.ejemplo.com/",
    );
    const u = new URL(url);
    expect(u.origin).toBe("https://agenda.ejemplo.com");
    expect(u.pathname).toBe("/calendario/ana/llamada");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      embed: "1",
      hideEventTypeDetails: "1",
      tz: "America/Costa_Rica",
      name: "Ana",
      email: "a@b.com",
      presupuesto: "1000",
      gclid: "g1",
      referrer: "https://mi-web.com/p",
    });
  });

  it("rechaza calLink mal formado y temas desconocidos", () => {
    expect(() => buildEmbedIframeUrl("ana", {})).toThrow();
    expect(() => buildEmbedIframeUrl("https://x.com/ana/llamada", {})).toThrow();
    expect(buildEmbedIframeUrl("ana/llamada", { theme: "neon" })).toBe("/calendario/ana/llamada?embed=1");
  });

  it("parentUtmFromSearch lee solo las claves conocidas", () => {
    expect(parentUtmFromSearch("?utm_source=ig&utm_campaign=oct&fbclid=f1&otra=x")).toEqual({ utm_source: "ig", utm_campaign: "oct", fbclid: "f1" });
  });
});

// ── Formularios (F10): f/<slug> ──────────────────────────────────────────────  @plantilla-quitar(formularios)
import { filterHostParams, formSlugOfLink, isFormLink, parentAttributionFromSearch } from "./url";

describe("embed de formularios: f/<slug>", () => {
  it("arma /f/<slug> con los UTM y ids de clic de la página padre", () => {
    expect(buildEmbedIframeUrl("f/aplicacion", {}, { utm_source: "facebook", fbclid: "x" }, "https://app.x")).toBe(
      "https://app.x/f/aplicacion?embed=1&utm_source=facebook&fbclid=x",
    );
  });

  it("un link de la Agenda sigue armando /calendario/... exactamente igual", () => {
    expect(buildEmbedIframeUrl("ana/llamada", {}, {}, "https://app.x")).toBe("https://app.x/calendario/ana/llamada?embed=1");
    expect(buildEmbedIframeUrl("ana/llamada", { theme: "dark" }, { utm_source: "web" })).toBe("/calendario/ana/llamada?embed=1&theme=dark&utm_source=web");
  });

  it("suma los parámetros de la página y lo que fija el embed, y NO los sensibles", () => {
    const url = buildEmbedIframeUrl(
      "f/aplicacion",
      { prefill: { plan: "pro" } },
      {},
      "https://app.x",
      { hostParams: { email: "a@x.com", token: "zzz", _ga: "x", password: "p", session: "s" } },
    );
    const params = new URL(url).searchParams;
    expect(params.get("email")).toBe("a@x.com");
    expect(params.get("plan")).toBe("pro");
    for (const k of ["token", "_ga", "password", "session"]) expect(params.has(k), k).toBe(false);
  });

  it("lo que fija el embed gana sobre la URL de la página", () => {
    const url = buildEmbedIframeUrl("f/aplicacion", { prefill: { plan: "pro" } }, {}, undefined, { hostParams: { plan: "basic" } });
    expect(new URL(url, "https://x").searchParams.get("plan")).toBe("pro");
  });

  it("pasa attr y referrer; los ids de anuncio salen de parentAttribution", () => {
    const url = buildEmbedIframeUrl("f/aplicacion", { referrer: "https://sitio.test/promo" }, {}, undefined, {
      attr: "abc",
      parentAttribution: { ad_id: "123", msclkid: "m1" },
    });
    const params = new URL(url, "https://x").searchParams;
    expect(params.get("attr")).toBe("abc");
    expect(params.get("referrer")).toBe("https://sitio.test/promo");
    expect(params.get("ad_id")).toBe("123");
    expect(params.get("msclkid")).toBe("m1");
  });

  it("el slug tiene que ser válido para ser un formulario", () => {
    expect(isFormLink("f/aplicacion")).toBe(true);
    expect(isFormLink("f/ab")).toBe(false);
    expect(isFormLink("ana/llamada")).toBe(false);
    expect(formSlugOfLink("f/como-vas")).toBe("como-vas");
    expect(formSlugOfLink("ana/llamada")).toBeNull();
  });
});

describe("filterHostParams", () => {
  it("topes: 30 parámetros, valores de 500 caracteres, nombres válidos", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 40; i++) many[`p${i}`] = "v";
    expect(Object.keys(filterHostParams(many))).toHaveLength(30);
    expect(filterHostParams({ largo: "x".repeat(900) }).largo).toHaveLength(500);
    expect(filterHostParams({ "mal nombre": "x", ok: "y", vacio: "" })).toEqual({ ok: "y" });
  });

  it("no reenvía los de atribución ni los reservados", () => {
    expect(filterHostParams({ utm_source: "a", fbclid: "b", embed: "1", referrer: "x", attr: "y", c: "z", plan: "pro" })).toEqual({ plan: "pro" });
  });
});

describe("parentAttributionFromSearch", () => {
  it("junta todas las claves de atribución de la página padre", () => {
    expect(parentAttributionFromSearch("?utm_source=meta&msclkid=m&gbraid=g&ad_id=1&ScCid=s&email=a@x.com")).toEqual({
      utm_source: "meta",
      msclkid: "m",
      gbraid: "g",
      ad_id: "1",
      sccid: "s",
    });
  });
});
