import { describe, expect, it } from "vitest";
import { compareSaleSummaries, isDbSort, pageOfSortedIds, parseSalesSort, salesSortToParams, type SaleSummary } from "./sort";

const s = (id: string, saleDate: string, over: Partial<SaleSummary> = {}): SaleSummary => ({ id, saleDate, amount: 0, paid: 0, pending: 0, nextDue: null, ...over });

describe("orden de Ventas en la URL", () => {
  it("sin nada, por fecha de la más nueva", () => {
    expect(parseSalesSort({})).toEqual({ key: "date", dir: "desc" });
  });

  it("lee columna y sentido; lo desconocido vuelve a lo normal", () => {
    expect(parseSalesSort({ orden: "next_payment", dir: "desc" })).toEqual({ key: "next_payment", dir: "desc" });
    expect(parseSalesSort({ orden: "next_payment" })).toEqual({ key: "next_payment", dir: "asc" });
    expect(parseSalesSort({ orden: "pending", dir: "rara" })).toEqual({ key: "pending", dir: "desc" });
    expect(parseSalesSort({ orden: "contact", dir: "asc" })).toEqual({ key: "date", dir: "desc" });
  });

  it("el orden normal no escribe nada; otro sí", () => {
    const p = new URLSearchParams();
    salesSortToParams({ key: "date", dir: "desc" }, p);
    expect(p.toString()).toBe("");
    salesSortToParams({ key: "date", dir: "asc" }, p);
    expect(p.toString()).toBe("orden=date&dir=asc");
  });

  it("fecha y monto los ordena la base; el resto, la pasada completa", () => {
    expect(isDbSort({ key: "date", dir: "asc" })).toBe(true);
    expect(isDbSort({ key: "amount", dir: "desc" })).toBe(true);
    expect(isDbSort({ key: "pending", dir: "desc" })).toBe(false);
    expect(isDbSort({ key: "next_payment", dir: "asc" })).toBe(false);
  });
});

describe("comparar ventas", () => {
  const rows = [
    s("a", "2026-10-01", { nextDue: "2026-12-01", pending: 100 }),
    s("b", "2026-10-02", { nextDue: null, pending: 0 }),
    s("c", "2026-10-03", { nextDue: "2026-11-01", pending: 300 }),
    s("d", "2026-10-04", { nextDue: "2026-12-01", pending: 200 }),
  ];

  it("próximo pago: el más cercano primero, sin próximo pago al final", () => {
    expect(pageOfSortedIds(rows, { key: "next_payment", dir: "asc" }, 0, 10)).toEqual(["c", "d", "a", "b"]);
  });

  it("al invertir, lo vacío sigue al final", () => {
    expect(pageOfSortedIds(rows, { key: "next_payment", dir: "desc" }, 0, 10)).toEqual(["d", "a", "c", "b"]);
  });

  it("misma fecha de próximo pago: primero la venta más nueva", () => {
    expect(compareSaleSummaries(rows[0], rows[3], { key: "next_payment", dir: "asc" })).toBeGreaterThan(0);
  });

  it("pendiente de mayor a menor y la página se corta después de ordenar", () => {
    expect(pageOfSortedIds(rows, { key: "pending", dir: "desc" }, 0, 2)).toEqual(["c", "d"]);
    expect(pageOfSortedIds(rows, { key: "pending", dir: "desc" }, 2, 2)).toEqual(["a", "b"]);
  });
});
