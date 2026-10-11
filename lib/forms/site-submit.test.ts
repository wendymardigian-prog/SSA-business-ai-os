import { describe, it, expect } from "vitest";
import { flattenSearchParams, normalizeSitePath, submitOriginFields } from "./site-submit";

describe("normalizeSitePath", () => {
  it("deja la ruta limpia: sin query, sin hash, sin barra final", () => {
    expect(normalizeSitePath("/servicios?utm_source=meta#form")).toBe("/servicios");
    expect(normalizeSitePath("/servicios/")).toBe("/servicios");
    expect(normalizeSitePath("/")).toBe("/");
    expect(normalizeSitePath("//a///b")).toBe("/a/b");
  });
  it("lo que no es una ruta no sirve", () => {
    expect(normalizeSitePath("")).toBeNull();
    expect(normalizeSitePath("servicios")).toBeNull();
    expect(normalizeSitePath(null)).toBeNull();
    expect(normalizeSitePath(undefined)).toBeNull();
  });
  it("recorta a 300 caracteres (el tope del pedido)", () => {
    expect(normalizeSitePath(`/${"a".repeat(500)}`)).toHaveLength(300);
  });
});

describe("submitOriginFields", () => {
  it("en el sitio: origin 'site' y la ruta de la página", () => {
    expect(submitOriginFields("site", "/servicios?x=1")).toEqual({ origin: "site", site_path: "/servicios" });
  });
  it("en el sitio sin una ruta válida: origin 'site' sin site_path", () => {
    expect(submitOriginFields("site", "")).toEqual({ origin: "site" });
  });
  it("en /f y en un embed no viaja site_path aunque llegue una ruta", () => {
    expect(submitOriginFields("public_page", "/f/x")).toEqual({ origin: "public_page" });
    expect(submitOriginFields("embed", "/f/x")).toEqual({ origin: "embed" });
  });
});

describe("flattenSearchParams", () => {
  it("el primer valor de cada nombre", () => {
    expect(flattenSearchParams(new URLSearchParams("a=1&a=2&b=3"))).toEqual({ a: "1", b: "3" });
  });
});
