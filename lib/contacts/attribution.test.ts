import { describe, it, expect } from "vitest";
import {
  mergeAttribution,
  parseTrackingParams,
  readAttribution,
  isAttributionEmpty,
} from "./attribution";

describe("parseTrackingParams", () => {
  it("saca los parametros conocidos y descarta el resto", () => {
    const params = new URLSearchParams({
      utm_source: "facebook",
      utm_medium: "cpc",
      fbclid: "abc123",
      ref: "ignorar",
    });

    const click = parseTrackingParams(params, "2026-01-15T10:30:00.000Z");

    expect(click).toEqual({
      utm_source: "facebook",
      utm_medium: "cpc",
      fbclid: "abc123",
      captured_at: "2026-01-15T10:30:00.000Z",
    });
  });

  it("devuelve null cuando no vino ningun parametro de tracking", () => {
    expect(parseTrackingParams(new URLSearchParams({ page: "2" }))).toBeNull();
    expect(parseTrackingParams({})).toBeNull();
    expect(parseTrackingParams(null)).toBeNull();
  });

  it("ignora los vacios y los que no son texto", () => {
    expect(parseTrackingParams({ utm_source: "   ", gclid: 42 })).toBeNull();
  });
});

describe("mergeAttribution", () => {
  const primero = { utm_source: "facebook", captured_at: "2026-01-15T10:30:00.000Z" };
  const segundo = { utm_source: "google", captured_at: "2026-02-20T14:00:00.000Z" };

  it("sobre un contacto sin atribucion, la primera interaccion es first y last", () => {
    const result = mergeAttribution({}, primero);
    expect(result.first_click).toEqual(primero);
    expect(result.last_click).toEqual(primero);
  });

  it("no pisa el first_click nunca", () => {
    const result = mergeAttribution({ first_click: primero, last_click: primero }, segundo);
    expect(result.first_click).toEqual(primero);
    expect(result.last_click).toEqual(segundo);
  });

  it("aunque pasen muchas interacciones, el first sigue siendo el original", () => {
    let attribution = mergeAttribution({}, primero);
    attribution = mergeAttribution(attribution, segundo);
    attribution = mergeAttribution(attribution, {
      utm_source: "tiktok",
      captured_at: "2026-03-01T00:00:00.000Z",
    });

    expect(attribution.first_click?.utm_source).toBe("facebook");
    expect(attribution.last_click?.utm_source).toBe("tiktok");
  });

  it("una interaccion sin parametros no toca nada", () => {
    const previa = { first_click: primero, last_click: primero };
    expect(mergeAttribution(previa, null)).toEqual(previa);
    expect(mergeAttribution(previa, {})).toEqual(previa);
  });

  it("copia el click en vez de referenciarlo, para que mutarlo despues no ensucie la fila", () => {
    const click = { utm_source: "facebook" };
    const result = mergeAttribution({}, click);
    click.utm_source = "otro";
    expect(result.first_click?.utm_source).toBe("facebook");
  });
});

describe("readAttribution", () => {
  it("tolera un jsonb con cualquier forma sin romper", () => {
    expect(readAttribution(null)).toEqual({});
    expect(readAttribution("texto suelto")).toEqual({});
    expect(readAttribution([1, 2, 3])).toEqual({});
    expect(readAttribution({ first_click: "no es objeto" })).toEqual({});
  });

  it("se queda solo con las claves conocidas", () => {
    const result = readAttribution({
      first_click: { utm_source: "facebook", basura: "x", captured_at: "2026-01-01T00:00:00.000Z" },
    });
    expect(result.first_click).toEqual({
      utm_source: "facebook",
      captured_at: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("isAttributionEmpty", () => {
  it("distingue el contacto sin atribucion del que tiene", () => {
    expect(isAttributionEmpty({})).toBe(true);
    expect(isAttributionEmpty(readAttribution({ last_click: { gclid: "x" } }))).toBe(false);
  });
});
