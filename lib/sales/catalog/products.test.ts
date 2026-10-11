import { describe, expect, it } from "vitest";
import { defaultVariantPrice, isSellable, piecesLabel, productInputSchema, productRow, sortProducts, visibleProducts } from "./products";

const prod = (status: string, extra = {}) => ({ id: "p", name: "Programa", product_type: "programa", status, ...extra });

describe("productRow: un producto de cada estado", () => {
  const variants = [{ display_order: 0, archived_at: null, activePrice: 3000 }];
  it.each([
    ["active", "Activo"],
    ["inactive", "Inactivo"],
    ["discontinued", "Discontinuado"],
  ])("%s se muestra como %s", (status, label) => {
    const row = productRow(prod(status), variants, 2);
    expect(row.status).toBe(status);
    expect(row.statusLabel).toBe(label);
    expect(row.pieces).toBe(2);
    expect(row.priceLabel).toBe("$3.000,00");
  });

  it("un estado desconocido se trata como activo y un tipo desconocido como 'otro'", () => {
    const row = productRow(prod("raro", { product_type: "inventado" }), [], 0);
    expect(row.status).toBe("active");
    expect(row.type).toBe("otro");
    expect(row.priceLabel).toBe("Sin precio publicado");
  });
});

describe("defaultVariantPrice", () => {
  it("usa la variante de menor orden que no esté archivada", () => {
    expect(
      defaultVariantPrice([
        { display_order: 2, archived_at: null, activePrice: 200 },
        { display_order: 0, archived_at: "2026-10-01", activePrice: 50 },
        { display_order: 1, archived_at: null, activePrice: 100 },
      ]),
    ).toBe(100);
  });
  it("sin variantes o sin precio es null", () => {
    expect(defaultVariantPrice([])).toBeNull();
    expect(defaultVariantPrice([{ display_order: 0, archived_at: null, activePrice: null }])).toBeNull();
  });
});

describe("selección y orden", () => {
  it("solo un activo es vendible", () => {
    expect(isSellable({ status: "active" })).toBe(true);
    expect(isSellable({ status: "inactive" })).toBe(false);
    expect(isSellable({ status: "discontinued" })).toBe(false);
  });
  it("orden: activos, inactivos, discontinuados; dentro, por nombre en español", () => {
    const rows = [
      { status: "discontinued" as const, name: "B" },
      { status: "active" as const, name: "Óptimo" },
      { status: "inactive" as const, name: "C" },
      { status: "active" as const, name: "Alfa" },
    ];
    expect(sortProducts(rows).map((r) => r.name)).toEqual(["Alfa", "Óptimo", "C", "B"]);
  });
  it("oculta los discontinuados salvo que se pida verlos", () => {
    const rows = [{ status: "active" as const }, { status: "discontinued" as const }];
    expect(visibleProducts(rows, false)).toHaveLength(1);
    expect(visibleProducts(rows, true)).toHaveLength(2);
  });
  it("piecesLabel", () => {
    expect(piecesLabel(0)).toBe("Sin piezas");
    expect(piecesLabel(1)).toBe("1 pieza");
    expect(piecesLabel(3)).toBe("3 piezas");
  });
});

describe("productInputSchema", () => {
  it("el tipo por defecto es 'otro' y recorta el nombre", () => {
    const r = productInputSchema.parse({ name: "  Mentoría 1:1 " });
    expect(r).toMatchObject({ name: "Mentoría 1:1", type: "otro" });
  });
  it("rechaza nombre vacío o tipo inventado", () => {
    expect(productInputSchema.safeParse({ name: " " }).success).toBe(false);
    expect(productInputSchema.safeParse({ name: "x", type: "inventado" }).success).toBe(false);
  });
});
