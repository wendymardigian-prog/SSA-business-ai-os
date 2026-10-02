import { describe, it, expect } from "vitest";
import { matchesSearch } from "./search";

describe("matchesSearch (buscador de Broadcasts, Sequences y Growth)", () => {
  it("sin busqueda, todo coincide", () => {
    expect(matchesSearch("", "Lo que sea")).toBe(true);
    expect(matchesSearch("   ", null)).toBe(true);
  });

  it("ignora mayusculas y tildes, en los dos sentidos", () => {
    expect(matchesSearch("promocion", "Promoción de octubre")).toBe(true);
    expect(matchesSearch("PROMOCIÓN", "promocion")).toBe(true);
  });

  it("busca en cualquiera de los textos que se le pasen", () => {
    expect(matchesSearch("precio", "Regla 1", "precio, info")).toBe(true);
    expect(matchesSearch("precio", "Regla 1", null, undefined)).toBe(false);
  });

  it("no inventa coincidencias", () => {
    expect(matchesSearch("ventas", "Bienvenida")).toBe(false);
  });
});
