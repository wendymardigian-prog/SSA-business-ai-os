import { describe, expect, it } from "vitest";
import { loadContactTouchTimeline, TIMELINE_FETCH_LIMIT } from "./load-touches";

/** Un cliente de mentira que responde segun las columnas pedidas y recuerda cada pedido. */
function fakeClient(respond: (columns: string) => { data: unknown[] | null; error: { code?: string; message: string } | null }) {
  const requested: string[] = [];
  const filters: Array<[string, unknown]> = [];
  const builder = (columns: string) => {
    requested.push(columns);
    const chain = {
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return chain;
      },
      order: () => chain,
      limit: async () => respond(columns),
    };
    return chain;
  };
  return { client: { from: () => ({ select: builder }) } as never, requested, filters };
}

const row = (i: number) => ({ id: `t${i}`, occurred_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z` });

describe("loadContactTouchTimeline (F45)", () => {
  it("pide columnas explicitas y filtra por contacto Y workspace", async () => {
    const f = fakeClient(() => ({ data: [row(1)], error: null }));
    const res = await loadContactTouchTimeline(f.client, "ws", "c1");
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1);
    expect(f.requested[0]).not.toContain("*");
    expect(f.requested[0]).toContain("channel");
    expect(f.filters).toEqual([["contact_id", "c1"], ["workspace_id", "ws"]]);
  });

  it("si una columna reciente todavia no existe, repite con menos columnas", async () => {
    const f = fakeClient((columns) =>
      columns.includes("channel") || columns.includes("entry_url")
        ? { data: null, error: { code: "42703", message: "column does not exist" } }
        : { data: [row(1)], error: null },
    );
    const res = await loadContactTouchTimeline(f.client, "ws", "c1");
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(1);
    expect(f.requested).toHaveLength(3);
  });

  it("otro error se devuelve tal cual: nunca se toma como 'sin toques'", async () => {
    const f = fakeClient(() => ({ data: null, error: { code: "42501", message: "permission denied" } }));
    const res = await loadContactTouchTimeline(f.client, "ws", "c1");
    expect(res.error?.code).toBe("42501");
    expect(res.data).toEqual([]);
  });

  it("avisa si hay mas toques que el tope", async () => {
    const rows = Array.from({ length: TIMELINE_FETCH_LIMIT + 1 }, (_, i) => row(i));
    const f = fakeClient(() => ({ data: rows, error: null }));
    const res = await loadContactTouchTimeline(f.client, "ws", "c1");
    expect(res.truncated).toBe(true);
    expect(res.data).toHaveLength(TIMELINE_FETCH_LIMIT);
  });
});
