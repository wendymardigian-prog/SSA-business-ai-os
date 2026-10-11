/**
 * Caracterización del embed de la Agenda ANTES de que Formularios (F10) le
 * sume `f/<slug>`. Para cualquier link de agenda la URL tiene que ser
 * exactamente la de hoy.
 */
import { describe, it, expect } from "vitest";
import { buildEmbedIframeUrl } from "./url";

const ORIGIN = "https://app.test";

describe("buildEmbedIframeUrl: links de la Agenda no cambian", () => {
  it("link simple", () => {
    expect(buildEmbedIframeUrl("ana/llamada", {}, {}, ORIGIN)).toBe(
      `${ORIGIN}/calendario/ana/llamada?embed=1`,
    );
  });

  it("con UTM y click ids de la página padre", () => {
    expect(
      buildEmbedIframeUrl("ana/llamada", {}, { utm_source: "facebook", fbclid: "x1" }, ORIGIN),
    ).toBe(`${ORIGIN}/calendario/ana/llamada?embed=1&utm_source=facebook&fbclid=x1`);
  });

  it("con tema y color", () => {
    const url = buildEmbedIframeUrl("ana/llamada", { theme: "dark", color: "ff0000" }, {}, ORIGIN);
    expect(url.startsWith(`${ORIGIN}/calendario/ana/llamada?embed=1`)).toBe(true);
    expect(url).toContain("theme=dark");
  });

  it("un link inválido sigue siendo inválido", () => {
    expect(() => buildEmbedIframeUrl("no es un link", {}, {}, ORIGIN)).toThrow();
  });
});
