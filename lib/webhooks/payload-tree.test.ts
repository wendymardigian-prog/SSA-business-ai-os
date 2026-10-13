import { describe, expect, it } from "vitest";
import { flattenPaths, leafTypeOf } from "./payload-tree";

describe("flattenPaths", () => {
  it("a.b (numero) y c.0.d (texto)", () => {
    expect(flattenPaths({ a: { b: 1 }, c: [{ d: "x" }] })).toEqual([
      { path: "a.b", type: "number", sample: "1" },
      { path: "c.0.d", type: "text", sample: "x" },
    ]);
  });

  it("detecta booleanos y fechas ISO", () => {
    const leaves = flattenPaths({ ok: true, at: "2026-10-12T10:00:00Z", day: "2026-10-12", not: "2026-13-99", phone: "506 8888" });
    expect(leaves.map((l) => [l.path, l.type])).toEqual([["ok", "boolean"], ["at", "date"], ["day", "date"], ["not", "text"], ["phone", "text"]]);
  });

  it("con 20 niveles no pasa de maxDepth ni lanza", () => {
    let deep: unknown = "fin";
    for (let i = 0; i < 20; i++) deep = { n: deep };
    expect(() => flattenPaths(deep)).not.toThrow();
    expect(flattenPaths(deep)).toEqual([]);
    const shallow = flattenPaths({ a: { b: { c: { d: { e: { f: { g: { h: "ok", i: { j: "no" } } } } } } } } });
    expect(shallow.map((l) => l.path)).toEqual(["a.b.c.d.e.f.g.h"]);
    for (const leaf of shallow) expect(leaf.path.split(".").length).toBeLessThanOrEqual(8);
  });

  it("respeta el tope de hojas", () => {
    const big = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
    expect(flattenPaths(big)).toHaveLength(300);
    expect(flattenPaths(big, 8, 10)).toHaveLength(10);
  });

  it("ignora null, vacios y claves peligrosas; recorta el ejemplo", () => {
    const leaves = flattenPaths(JSON.parse('{"a":null,"b":"","c":[],"d":{},"__proto__":{"x":1},"e":"' + "z".repeat(200) + '"}'));
    expect(leaves).toHaveLength(1);
    expect(leaves[0].path).toBe("e");
    expect(leaves[0].sample).toHaveLength(80);
  });

  it("una raiz que no es objeto no da hojas ni lanza", () => {
    for (const v of [null, undefined, 5, "x", [], [[]]]) expect(() => flattenPaths(v)).not.toThrow();
    expect(flattenPaths(null)).toEqual([]);
    expect(flattenPaths([{ a: 1 }]).map((l) => l.path)).toEqual(["0.a"]);
  });
});

describe("leafTypeOf", () => {
  it("numero, booleano, fecha y texto", () => {
    expect(leafTypeOf(3)).toBe("number");
    expect(leafTypeOf(false)).toBe("boolean");
    expect(leafTypeOf("2026-10-12")).toBe("date");
    expect(leafTypeOf("hola")).toBe("text");
  });
});
