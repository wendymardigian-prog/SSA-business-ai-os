import { describe, expect, it } from "vitest";
import { inChunks, loadAllTasks } from "./load-all";

/** Un cliente simulado que, como PostgREST, devuelve como mucho 1.000 filas por pedido. */
function fakeDb(total: number, opts: { failFrom?: number } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `t${i}` }));
  const calls: Array<[number, number]> = [];
  const db = {
    from() {
      let withCount = false;
      const q = {
        select(_cols: string, o?: { count?: string }) {
          withCount = o?.count === "exact";
          return q;
        },
        eq: () => q,
        is: () => q,
        order: () => q,
        range(from: number, to: number) {
          calls.push([from, to]);
          if (opts.failFrom !== undefined && from >= opts.failFrom) return Promise.resolve({ data: null, error: { message: "caída" } });
          const data = rows.slice(from, Math.min(to + 1, from + 1000));
          return Promise.resolve({ data, error: null, count: withCount ? total : null });
        },
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

describe("Tareas: leer todas, no solo las 1.000 más nuevas", () => {
  it("2.395 tareas se leen en 3 pedidos y llegan todas", async () => {
    const { db, calls } = fakeDb(2395);
    const r = await loadAllTasks<{ id: string }>(db, "ws", "id", 5000);
    expect(r.error).toBeNull();
    expect(r.rows).toHaveLength(2395);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("con menos de 1.000, un solo pedido", async () => {
    const { db, calls } = fakeDb(10);
    const r = await loadAllTasks<{ id: string }>(db, "ws", "id", 5000);
    expect(r.rows).toHaveLength(10);
    expect(calls).toHaveLength(1);
  });

  it("no pasa del tope", async () => {
    const { db } = fakeDb(7000);
    const r = await loadAllTasks<{ id: string }>(db, "ws", "id", 5000);
    expect(r.rows).toHaveLength(5000);
  });

  it("si falla una página, avisa el error", async () => {
    const { db } = fakeDb(2500, { failFrom: 1000 });
    const r = await loadAllTasks<{ id: string }>(db, "ws", "id", 5000);
    expect(r.error).toBe("caída");
  });
});

describe("inChunks", () => {
  it("parte los ids en tandas y junta lo que vuelve", async () => {
    const seen: number[] = [];
    const out = await inChunks(Array.from({ length: 450 }, (_, i) => `c${i}`), 200, (slice) => {
      seen.push(slice.length);
      return Promise.resolve({ data: slice.map((id) => ({ id })) });
    });
    expect(seen).toEqual([200, 200, 50]);
    expect(out).toHaveLength(450);
  });

  it("sin ids no pide nada", async () => {
    let calls = 0;
    expect(await inChunks([], 200, () => { calls++; return Promise.resolve({ data: [] }); })).toEqual([]);
    expect(calls).toBe(0);
  });
});
