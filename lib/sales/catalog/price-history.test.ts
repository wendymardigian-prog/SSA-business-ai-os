import { describe, expect, it } from "vitest";
import { newVersionDraftFrom, priceHistory } from "./price-history";

const v = (id: string, n: number, status: string, price: number, extra = {}) => ({ id, version_number: n, status, price, change_notes: null, published_at: null, published_by: null, ...extra });

describe("priceHistory", () => {
  const versions = [v("a", 1, "deprecated", 1000), v("b", 2, "active", 1200, { change_notes: "Sube por inflación", published_by: "u1" }), v("c", 3, "draft", 1300)];

  it("ordena de la más nueva a la más vieja y muestra precio, estado y notas", () => {
    const rows = priceHistory(versions, { a: 3 }, { u1: "Ana" });
    expect(rows.map((r) => r.number)).toEqual([3, 2, 1]);
    expect(rows[1]).toMatchObject({ priceLabel: "$1.200,00", statusLabel: "Activa", notes: "Sube por inflación", publishedBy: "Ana" });
  });

  it("una versión con 3 ventas muestra 3 y no se puede borrar", () => {
    const rows = priceHistory(versions, { a: 3 });
    const a = rows.find((r) => r.id === "a")!;
    expect(a.sales).toBe(3);
    expect(a.canDelete).toBe(false);
  });

  it("solo el borrador sin ventas se puede borrar", () => {
    const rows = priceHistory(versions, {});
    expect(rows.find((r) => r.id === "c")!.canDelete).toBe(true);
    expect(rows.find((r) => r.id === "b")!.canDelete).toBe(false);
  });
});

describe("newVersionDraftFrom", () => {
  it("arranca con los valores de la activa", () => {
    expect(newVersionDraftFrom([v("a", 1, "deprecated", 1000), v("b", 2, "active", 1200)])).toEqual({ price: 1200, change_notes: "" });
  });
  it("sin activa, de la última", () => {
    expect(newVersionDraftFrom([v("a", 1, "deprecated", 1000), v("c", 3, "draft", 1300)])).toEqual({ price: 1300, change_notes: "" });
  });
  it("sin versiones no hay de dónde copiar", () => {
    expect(newVersionDraftFrom([])).toBeNull();
  });
});
