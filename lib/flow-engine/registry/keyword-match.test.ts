/** Auditoria de automatizaciones: como se comparan las palabras clave. */
import { describe, expect, it } from "vitest";
import { keywordMatches } from "./triggers";

const m = (text: string, keywords: Array<string | { value: string; matchType?: string }>, matchType?: string) =>
  keywordMatches({ text, config: { keywords, matchType } } as never);

describe("keywordMatches", () => {
  it("no distingue tildes ni mayusculas", () => {
    expect(m("Quiero INFORMACIÓN", ["informacion"])).toBe(true);
    expect(m("quiero informacion", ["Información"])).toBe(true);
  });
  it("contiene: la palabra empieza en un borde (si no encaja en así, precio si en precios)", () => {
    expect(m("así es", ["si"])).toBe(false);
    expect(m("si, me interesa", ["si"])).toBe(true);
    expect(m("¿los precios?", ["precio"])).toBe(true);
  });
  it("exacto ignora los signos de los costados", () => {
    expect(m("¡Hola!", [{ value: "hola", matchType: "exact" }])).toBe(true);
    expect(m("hola que tal", [{ value: "hola", matchType: "exact" }])).toBe(false);
  });
  it("empieza con", () => {
    expect(m("Precio del curso", [{ value: "precio", matchType: "startsWith" }])).toBe(true);
  });
  it("una palabra con signos de regex no rompe", () => {
    expect(m("cuesta $100?", ["$100"])).toBe(true);
  });
});
