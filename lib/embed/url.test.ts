import { describe, it, expect } from "vitest";
import { buildEmbedIframeUrl, parentUtmFromSearch } from "./url";

describe("buildEmbedIframeUrl (F39)", () => {
  it("genera la URL del plano conservando los UTM de la página padre", () => {
    expect(buildEmbedIframeUrl("wendy/llamada", { theme: "dark", color: "#aa00ff" }, { utm_source: "instagram" })).toBe(
      "/calendario/wendy/llamada?embed=1&theme=dark&color=%23aa00ff&utm_source=instagram",
    );
  });

  it("brandColor es alias de color; un color que no es hex se ignora", () => {
    expect(buildEmbedIframeUrl("wendy/llamada", { brandColor: "AA00FF" })).toBe("/calendario/wendy/llamada?embed=1&color=%23aa00ff");
    expect(buildEmbedIframeUrl("wendy/llamada", { brandColor: "rojo" })).toBe("/calendario/wendy/llamada?embed=1");
  });

  it("precarga, zona, otras preguntas, referrer y origen absoluto", () => {
    const url = buildEmbedIframeUrl(
      "wendy/llamada",
      { name: "Ana", email: "a@b.com", presupuesto: "1000", "Mal Nombre": "x", tz: "America/Costa_Rica", referrer: "https://mi-web.com/p", hideEventTypeDetails: true },
      { gclid: "g1" },
      "https://agenda.ejemplo.com/",
    );
    const u = new URL(url);
    expect(u.origin).toBe("https://agenda.ejemplo.com");
    expect(u.pathname).toBe("/calendario/wendy/llamada");
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
    expect(() => buildEmbedIframeUrl("wendy", {})).toThrow();
    expect(() => buildEmbedIframeUrl("https://x.com/wendy/llamada", {})).toThrow();
    expect(buildEmbedIframeUrl("wendy/llamada", { theme: "neon" })).toBe("/calendario/wendy/llamada?embed=1");
  });

  it("parentUtmFromSearch lee solo las claves conocidas", () => {
    expect(parentUtmFromSearch("?utm_source=ig&utm_campaign=oct&fbclid=f1&otra=x")).toEqual({ utm_source: "ig", utm_campaign: "oct", fbclid: "f1" });
  });
});
