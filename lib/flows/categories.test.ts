import { describe, expect, it } from "vitest";
import { categoryKey, categorySuggestions, normalizeCategories, normalizeDescription, MAX_CATEGORIES_PER_FLOW } from "./categories";

describe("normalizeCategories", () => {
  it("limpia espacios, saca repetidas sin mirar mayusculas ni tildes y conserva la primera forma", () => {
    expect(normalizeCategories(["  Ventas ", "ventas", "Véntas", "Atención   al cliente", "", 3, null])).toEqual(["Ventas", "Atención al cliente"]);
  });
  it("respeta el tope por flujo y el largo", () => {
    const many = Array.from({ length: 15 }, (_, i) => `cat ${i}`);
    expect(normalizeCategories(many)).toHaveLength(MAX_CATEGORIES_PER_FLOW);
    expect(normalizeCategories(["x".repeat(80)])[0]).toHaveLength(40);
  });
  it("algo que no es una lista da vacio", () => {
    expect(normalizeCategories("Ventas")).toEqual([]);
  });
});

describe("categorySuggestions", () => {
  it("ordena por uso y une las formas de la misma categoria", () => {
    const flows = [{ categories: ["Ventas", "Bienvenida"] }, { categories: ["ventas"] }, { categories: ["Ventas"] }, { categories: null }];
    expect(categorySuggestions(flows)).toEqual([
      { name: "Ventas", count: 3 },
      { name: "Bienvenida", count: 1 },
    ]);
  });
});

describe("otros", () => {
  it("categoryKey compara sin tildes", () => expect(categoryKey("Atención")).toBe(categoryKey("atencion")));
  it("normalizeDescription recorta y vacia => null", () => {
    expect(normalizeDescription("   ")).toBeNull();
    expect(normalizeDescription(" hola ")).toBe("hola");
    expect(normalizeDescription("x".repeat(600))).toHaveLength(500);
  });
});
