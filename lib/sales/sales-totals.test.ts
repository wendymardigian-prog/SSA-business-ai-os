import { describe, expect, it } from "vitest";
import { computeSalesTotals, PAYMENT_CHUNK } from "./sales-totals";

const page = <T,>(rows: T[]) => async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null });

describe("totales de Ventas", () => {
  const sales = [
    { id: "s1", final_amount: 1200 },
    { id: "s2", final_amount: "600.00" },
    { id: "s3", final_amount: 1500 },
  ];
  const payments = [
    { sale_id: "s1", amount: 400, status: "paid" },
    { sale_id: "s1", amount: 800, status: "scheduled" },
    { sale_id: "s2", amount: 600, status: "paid" },
    { sale_id: "s3", amount: 50, status: "paid" },
    { sale_id: "s3", amount: -20, status: "paid" },
  ];
  const fetchPayments = (ids: string[], from: number, to: number) => page(payments.filter((p) => ids.includes(p.sale_id)))(from, to);

  it("suma monto, cobrado y pendiente de todo el filtro, brutos", async () => {
    const totals = await computeSalesTotals(page(sales), fetchPayments);
    expect(totals).toEqual({ count: 3, amount: 3300, paid: 1030, pending: 2270, truncated: false });
  });

  it("el total es la suma de lo que muestra cada fila", async () => {
    const totals = await computeSalesTotals(page(sales), fetchPayments);
    expect(totals!.paid! + totals!.pending!).toBe(totals!.amount);
  });

  it("sin ventas, nada que sumar: null y no 0", async () => {
    const totals = await computeSalesTotals(page([]), fetchPayments);
    expect(totals).toEqual({ count: 0, amount: null, paid: null, pending: null, truncated: false });
  });

  it("pide los pagos por tandas", async () => {
    const many = Array.from({ length: PAYMENT_CHUNK * 2 + 1 }, (_, i) => ({ id: `s${i}`, final_amount: 10 }));
    const asked: number[] = [];
    const totals = await computeSalesTotals(page(many), async (ids) => {
      asked.push(ids.length);
      return { data: [], error: null };
    });
    expect(asked.sort((a, b) => a - b)).toEqual([1, PAYMENT_CHUNK, PAYMENT_CHUNK]);
    expect(totals?.amount).toBe(many.length * 10);
  });

  it("si una consulta falla no se inventa un total", async () => {
    expect(await computeSalesTotals(async () => ({ data: null, error: { message: "x" } }), fetchPayments)).toBeNull();
    expect(await computeSalesTotals(page(sales), async () => ({ data: null, error: { message: "x" } }))).toBeNull();
  });
});
