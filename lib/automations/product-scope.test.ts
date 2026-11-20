import { describe, expect, it } from "vitest";
import { describeProductScope, productScopeMatches, readProductScope, staleScopeIds, toggleScopeProduct, toggleScopeVariant, writeProductScope } from "./product-scope";

const catalog = [
  { id: "p1", name: "Curso", variants: [{ id: "v1", name: "Lite" }, { id: "v2", name: "Pro" }] },
  { id: "p2", name: "Mentoría", variants: [{ id: "v3", name: "Mensual" }] },
];

describe("readProductScope", () => {
  it("lee las listas", () => {
    expect(readProductScope({ product_ids: ["p1", "p1", ""], variant_ids: ["v3"] })).toEqual({ productIds: ["p1"], variantIds: ["v3"] });
  });
  it("convierte el filtro viejo de una variante (ya implica su producto)", () => {
    expect(readProductScope({ product_id: "p1", variant_id: "v1" })).toEqual({ productIds: [], variantIds: ["v1"] });
  });
  it("convierte el filtro viejo de un producto", () => {
    expect(readProductScope({ product_id: "p1", variant_id: null })).toEqual({ productIds: ["p1"], variantIds: [] });
  });
  it("las listas le ganan a lo viejo", () => {
    expect(readProductScope({ product_ids: ["p2"], product_id: "p1" })).toEqual({ productIds: ["p2"], variantIds: [] });
  });
  it("nada elegido o config rota", () => {
    expect(readProductScope(null)).toEqual({ productIds: [], variantIds: [] });
    expect(readProductScope({ product_ids: "p1" })).toEqual({ productIds: [], variantIds: [] });
  });
});

describe("productScopeMatches", () => {
  it("sin nada elegido entra todo, también un producto nuevo", () => {
    expect(productScopeMatches({ productIds: [], variantIds: [] }, "p-nuevo", "v-nueva")).toBe(true);
    expect(productScopeMatches({ productIds: [], variantIds: [] }, undefined, undefined)).toBe(true);
  });
  it("producto entero: cualquier variante, también una nueva", () => {
    const s = { productIds: ["p1"], variantIds: [] };
    expect(productScopeMatches(s, "p1", "v1")).toBe(true);
    expect(productScopeMatches(s, "p1", "v-nueva")).toBe(true);
    expect(productScopeMatches(s, "p2", "v3")).toBe(false);
  });
  it("variantes sueltas de productos distintos", () => {
    const s = { productIds: [], variantIds: ["v1", "v3"] };
    expect(productScopeMatches(s, "p1", "v1")).toBe(true);
    expect(productScopeMatches(s, "p2", "v3")).toBe(true);
    expect(productScopeMatches(s, "p1", "v2")).toBe(false);
  });
  it("con algo elegido, un evento sin producto ni variante no entra", () => {
    expect(productScopeMatches({ productIds: ["p1"], variantIds: [] }, null, null)).toBe(false);
  });
  it("producto entero o una variante de otro", () => {
    const s = { productIds: ["p2"], variantIds: ["v2"] };
    expect(productScopeMatches(s, "p2", "v3")).toBe(true);
    expect(productScopeMatches(s, "p1", "v2")).toBe(true);
    expect(productScopeMatches(s, "p1", "v1")).toBe(false);
  });
});

describe("elegir", () => {
  it("elegir el producto entero saca sus variantes sueltas", () => {
    expect(toggleScopeProduct({ productIds: [], variantIds: ["v1", "v3"] }, catalog[0])).toEqual({ productIds: ["p1"], variantIds: ["v3"] });
  });
  it("soltar el producto", () => {
    expect(toggleScopeProduct({ productIds: ["p1"], variantIds: [] }, catalog[0])).toEqual({ productIds: [], variantIds: [] });
  });
  it("una variante con su producto entero elegido no cambia nada", () => {
    const s = { productIds: ["p1"], variantIds: [] };
    expect(toggleScopeVariant(s, "p1", "v1")).toBe(s);
  });
  it("prender y apagar una variante", () => {
    const on = toggleScopeVariant({ productIds: [], variantIds: [] }, "p1", "v2");
    expect(on).toEqual({ productIds: [], variantIds: ["v2"] });
    expect(toggleScopeVariant(on, "p1", "v2")).toEqual({ productIds: [], variantIds: [] });
  });
});

describe("guardar y describir", () => {
  it("guarda listas y borra los filtros viejos", () => {
    expect(writeProductScope({ productIds: ["p1"], variantIds: [] })).toEqual({ product_ids: ["p1"], variant_ids: undefined, product_id: null, variant_id: null });
  });
  it("lo que ya no existe se avisa", () => {
    expect(staleScopeIds({ productIds: ["px"], variantIds: ["v1", "vx"] }, catalog)).toEqual({ products: ["px"], variants: ["vx"] });
  });
  it("en palabras", () => {
    expect(describeProductScope({ productIds: [], variantIds: [] }, catalog)).toBe("cualquier producto");
    expect(describeProductScope({ productIds: ["p2"], variantIds: ["v2"] }, catalog)).toBe("Curso (Pro), Mentoría");
    expect(describeProductScope({ productIds: ["px"], variantIds: [] }, catalog)).toBe("1 que ya no existe");
  });
});
