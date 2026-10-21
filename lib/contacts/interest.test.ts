import { describe, expect, it } from "vitest";
import { buildInterestCatalog, checkInterestChange, interestLabel, offeredProducts, offeredVariants } from "./interest";

const catalog = buildInterestCatalog(
  [
    { id: "p-vip", name: "Programa VIP", status: "active" },
    { id: "p-viejo", name: "Curso viejo", status: "discontinued", archived_at: "2026-01-01T00:00:00Z" },
  ],
  [
    { id: "v-mensual", product_id: "p-vip", name: "Mensual", archived_at: null, display_order: 1 },
    { id: "v-anual", product_id: "p-vip", name: "Anual", archived_at: null, display_order: 0 },
    { id: "v-beta", product_id: "p-vip", name: "Beta", archived_at: "2026-02-01T00:00:00Z", display_order: 2 },
    { id: "v-viejo", product_id: "p-viejo", name: "Única", archived_at: null },
  ],
);

describe("producto de interés", () => {
  it("ordena productos por nombre y variantes por orden", () => {
    expect(catalog.map((p) => p.id)).toEqual(["p-viejo", "p-vip"]);
    expect(catalog[1].variants.map((v) => v.id)).toEqual(["v-anual", "v-mensual", "v-beta"]);
  });

  it("no ofrece lo archivado, salvo lo que el contacto ya tiene", () => {
    expect(offeredProducts(catalog, null).map((p) => p.id)).toEqual(["p-vip"]);
    expect(offeredProducts(catalog, "p-viejo").map((p) => p.id)).toEqual(["p-viejo", "p-vip"]);
    expect(offeredVariants(catalog, "p-vip", null).map((v) => v.id)).toEqual(["v-anual", "v-mensual"]);
    expect(offeredVariants(catalog, "p-vip", "v-beta").map((v) => v.id)).toContain("v-beta");
  });

  it("la etiqueta", () => {
    expect(interestLabel(catalog, "p-vip", "v-mensual")).toBe("Programa VIP · Mensual");
    expect(interestLabel(catalog, "p-vip", null)).toBe("Programa VIP");
    expect(interestLabel(catalog, "p-viejo", null)).toBe("Curso viejo (archivado)");
    expect(interestLabel(catalog, null, null)).toBe("—");
  });

  it("qué se puede guardar", () => {
    const none = { productId: null, variantId: null };
    expect(checkInterestChange(catalog, none, { productId: "p-vip", variantId: "v-mensual" }).ok).toBe(true);
    expect(checkInterestChange(catalog, none, { productId: "p-vip", variantId: "v-viejo" }).ok).toBe(false);
    expect(checkInterestChange(catalog, none, { productId: null, variantId: "v-mensual" }).ok).toBe(false);
    expect(checkInterestChange(catalog, none, { productId: "p-viejo", variantId: null }).ok).toBe(false);
    expect(checkInterestChange(catalog, { productId: "p-viejo", variantId: null }, { productId: "p-viejo", variantId: "v-viejo" }).ok).toBe(true);
    expect(checkInterestChange(catalog, none, { productId: "p-vip", variantId: "v-beta" }).ok).toBe(false);
    expect(checkInterestChange(catalog, none, none).ok).toBe(true);
  });
});
