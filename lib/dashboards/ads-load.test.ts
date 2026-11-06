/**
 * Leer las metricas de a paginas. PostgREST corta cada respuesta en 1.000 filas sin avisar, y sin paginar
 * «Últimos 90 días» e «Histórico» mostraban menos gasto del real.
 */

import { describe, expect, it, vi } from "vitest";
import { loadAdsInsights } from "./ads-load";

function row(i: number) {
  return { level: "account", object_id: "act_1", date: `2026-01-${i}`, spend: 1 };
}

/** Una base falsa que devuelve `total` filas respetando el `.range()` y anota lo que le pidieron. */
function fakeDb(total: number, options: { failOnPage?: number } = {}) {
  const calls: Array<{ ranges: [number, number]; filters: string[]; orders: string[] }> = [];

  function query() {
    const filters: string[] = [];
    const orders: string[] = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: string) => (filters.push(`${column}=${value}`), builder),
      gte: (column: string, value: string) => (filters.push(`${column}>=${value}`), builder),
      lte: (column: string, value: string) => (filters.push(`${column}<=${value}`), builder),
      order: (column: string) => (orders.push(column), builder),
      range: (from: number, to: number) => {
        calls.push({ ranges: [from, to], filters, orders });
        if (options.failOnPage === calls.length) return Promise.resolve({ data: null, error: { message: "fallo" } });
        const rows = Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => row(from + i));
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  return { db: { from: query } as never, calls };
}

const params = {
  workspaceId: "ws-1",
  adAccountId: "act_1",
  period: { from: "2026-09-02T06:00:00.000Z", to: "2026-09-06T05:59:59.999Z" },
  timeZone: "America/Costa_Rica",
};

describe("loadAdsInsights", () => {
  it("trae todas las filas aunque pasen de 1.000", async () => {
    const { db, calls } = fakeDb(2350);

    const rows = await loadAdsInsights(db, params);

    expect(rows).toHaveLength(2350);
    expect(calls.map((c) => c.ranges)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("cada pagina lleva el mismo filtro y un orden estable", async () => {
    const { db, calls } = fakeDb(1500);

    await loadAdsInsights(db, params);

    for (const call of calls) {
      expect(call.orders).toEqual(["date", "level", "object_id"]);
      expect(call.filters).toEqual(["workspace_id=ws-1", "ad_account_id=act_1", "date>=2026-09-02", "date<=2026-09-05"]);
    }
  });

  it("corta los dias en la zona que recibe, no en UTC", async () => {
    const { db, calls } = fakeDb(1);

    await loadAdsInsights(db, params);

    // En UTC, el fin del rango caeria el 6: dia que nadie eligio.
    expect(calls[0].filters).toContain("date<=2026-09-05");
  });

  it("sin puntas en el periodo (Histórico) no filtra por fecha", async () => {
    const { db, calls } = fakeDb(1);

    await loadAdsInsights(db, { ...params, period: { from: null, to: null } });

    expect(calls[0].filters).toEqual(["workspace_id=ws-1", "ad_account_id=act_1"]);
  });

  it("si falla una pagina no devuelve totales a medias", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb(1500, { failOnPage: 2 });

    expect(await loadAdsInsights(db, params)).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
