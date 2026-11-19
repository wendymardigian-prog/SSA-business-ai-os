import { describe, expect, it } from "vitest";
import { MAX_CATEGORIES, removeCategoryFrom, renameCategoryIn, sameCategories } from "./categories";

describe("renameCategoryIn", () => {
  it("reemplaza la categoria sin mirar mayusculas ni tildes y conserva el lugar", () => {
    expect(renameCategoryIn(["Bienvenida", "véntas", "Soporte"], "Ventas", "Comercial")).toEqual(["Bienvenida", "Comercial", "Soporte"]);
  });

  it("si el nombre nuevo ya estaba, quedan unidas sin repetirse", () => {
    expect(renameCategoryIn(["Ventas", "Comercial"], "ventas", "comercial")).toEqual(["comercial"]);
    expect(renameCategoryIn(["Comercial", "Ventas"], "Ventas", "Comercial")).toEqual(["Comercial"]);
  });

  it("una lista que no la tiene vuelve igual", () => {
    expect(renameCategoryIn(["Soporte"], "Ventas", "Comercial")).toEqual(["Soporte"]);
  });

  it("un nombre nuevo vacio no cambia nada", () => {
    expect(renameCategoryIn(["Ventas"], "Ventas", "   ")).toEqual(["Ventas"]);
  });

  it("respeta el tope", () => {
    const many = Array.from({ length: MAX_CATEGORIES }, (_, i) => `cat ${i}`);
    expect(renameCategoryIn(many, "cat 0", "otra")).toHaveLength(MAX_CATEGORIES);
  });
});

describe("removeCategoryFrom", () => {
  it("saca la categoria sin mirar mayusculas ni tildes", () => {
    expect(removeCategoryFrom(["Atención", "Ventas"], "atencion")).toEqual(["Ventas"]);
  });
  it("una lista que no la tiene vuelve igual", () => {
    expect(removeCategoryFrom(["Ventas"], "Soporte")).toEqual(["Ventas"]);
  });
});

describe("sameCategories", () => {
  it("compara orden y forma escrita", () => {
    expect(sameCategories(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameCategories(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameCategories(["Ventas"], ["ventas"])).toBe(false);
  });
});
