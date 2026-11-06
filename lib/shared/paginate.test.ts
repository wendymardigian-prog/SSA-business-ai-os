import { describe, expect, it } from "vitest";
import { fetchAllPages } from "./paginate";

const source = (n: number) => (from: number, to: number) =>
  Promise.resolve({ data: Array.from({ length: n }, (_, i) => i).slice(from, to + 1), error: null });

describe("fetchAllPages", () => {
  it("junta todas las páginas", async () => {
    const r = await fetchAllPages(source(2500), { pageSize: 1000 });
    expect(r.rows).toHaveLength(2500);
    expect(r.truncated).toBe(false);
    expect(r.error).toBeNull();
  });
  it("una página justa no se cuelga pidiendo otra vacía", async () => {
    let calls = 0;
    const r = await fetchAllPages((from, to) => { calls += 1; return source(2000)(from, to); }, { pageSize: 1000 });
    expect(r.rows).toHaveLength(2000);
    expect(calls).toBe(3);
  });
  it("corta en el tope y lo avisa", async () => {
    const r = await fetchAllPages(source(5000), { pageSize: 1000, maxRows: 3000 });
    expect(r.rows).toHaveLength(3000);
    expect(r.truncated).toBe(true);
  });
  it("si una página falla, devuelve el error y lo que ya tenía", async () => {
    let n = 0;
    const r = await fetchAllPages((from, to) => (++n === 2 ? Promise.resolve({ data: null, error: { message: "boom" } }) : source(5000)(from, to)), { pageSize: 1000 });
    expect(r.error).toBe("boom");
    expect(r.rows).toHaveLength(1000);
  });
});
