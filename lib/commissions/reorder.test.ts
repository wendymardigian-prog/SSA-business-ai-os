import { describe, expect, it } from "vitest";
import { planPositionMoves, sameIdSet, type PositionedRule } from "./reorder";

/** Aplica los movimientos y falla si alguno cae sobre una posición ocupada (lo que haría la restricción de la base). */
function apply(current: readonly PositionedRule[], moves: ReturnType<typeof planPositionMoves>): Map<string, number> {
  const pos = new Map(current.map((r) => [r.id, r.position]));
  for (const move of moves) {
    const taken = [...pos.entries()].find(([id, p]) => p === move.to && id !== move.id);
    if (taken) throw new Error(`choque: ${move.id} -> ${move.to} (ocupada por ${taken[0]})`);
    pos.set(move.id, move.to);
  }
  return pos;
}

const rules = (n: number): PositionedRule[] => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, position: i + 1 }));
const finalOrder = (pos: Map<string, number>) => [...pos.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);

describe("planPositionMoves", () => {
  it("sin cambios, no mueve nada", () => {
    expect(planPositionMoves(rules(4), ["r1", "r2", "r3", "r4"])).toEqual([]);
  });

  it("subir una regla mueve solo a las afectadas y no choca nunca (la que sube pasa un momento por una posición temporal)", () => {
    const moves = planPositionMoves(rules(5), ["r1", "r4", "r2", "r3", "r5"]);
    expect(new Set(moves.map((m) => m.id))).toEqual(new Set(["r2", "r3", "r4"]));
    expect(moves).toHaveLength(4);
    expect(moves.filter((m) => m.to > 5)).toHaveLength(1);
    expect(finalOrder(apply(rules(5), moves))).toEqual(["r1", "r4", "r2", "r3", "r5"]);
  });

  it("una cascada sin ciclo (después de archivar) no usa posiciones temporales", () => {
    const moves = planPositionMoves([{ id: "a", position: 2 }, { id: "b", position: 3 }, { id: "c", position: 4 }], ["a", "b", "c"]);
    expect(moves).toEqual([{ id: "a", to: 1 }, { id: "b", to: 2 }, { id: "c", to: 3 }]);
  });

  it("intercambiar dos reglas rompe el ciclo con una posición temporal", () => {
    const moves = planPositionMoves(rules(2), ["r2", "r1"]);
    expect(moves).toHaveLength(3);
    expect(moves.some((m) => m.to > 2)).toBe(true);
    expect(finalOrder(apply(rules(2), moves))).toEqual(["r2", "r1"]);
    expect([...apply(rules(2), moves).values()].sort()).toEqual([1, 2]);
  });

  it("invertir una lista entera termina en 1..N, sin choques", () => {
    const ids = rules(7).map((r) => r.id).reverse();
    const pos = apply(rules(7), planPositionMoves(rules(7), ids));
    expect(finalOrder(pos)).toEqual(ids);
    expect([...pos.values()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("compacta las posiciones con huecos (después de archivar)", () => {
    const gaps: PositionedRule[] = [{ id: "a", position: 1 }, { id: "c", position: 3 }, { id: "d", position: 4 }];
    const moves = planPositionMoves(gaps, ["a", "c", "d"]);
    expect(moves).toEqual([{ id: "c", to: 2 }, { id: "d", to: 3 }]);
  });

  it("cualquier permutación de hasta 6 reglas llega al orden pedido sin un solo choque", () => {
    const permutations = (list: string[]): string[][] => (list.length <= 1 ? [list] : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [x, ...p])));
    for (const n of [3, 4, 5, 6]) {
      const base = rules(n);
      for (const order of permutations(base.map((r) => r.id))) {
        const pos = apply(base, planPositionMoves(base, order));
        expect(finalOrder(pos)).toEqual(order);
        expect([...pos.values()].sort((a, b) => a - b)).toEqual(order.map((_, i) => i + 1));
      }
    }
  });

  it("un orden aleatorio de 40 reglas con posiciones salteadas no choca", () => {
    const base: PositionedRule[] = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, position: (i + 1) * 3 }));
    const order = base.map((r) => r.id).sort((a, b) => ((a.length + a.charCodeAt(1) * 7) % 11) - ((b.length + b.charCodeAt(1) * 7) % 11) || (a < b ? 1 : -1));
    const pos = apply(base, planPositionMoves(base, order));
    expect(finalOrder(pos)).toEqual(order);
  });
});

describe("sameIdSet", () => {
  it("el mismo conjunto, en cualquier orden", () => {
    expect(sameIdSet(["b", "a"], ["a", "b"])).toBe(true);
  });
  it("faltante, sobrante o repetido no sirven", () => {
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
    expect(sameIdSet(["a", "b", "c"], ["a", "b"])).toBe(false);
    expect(sameIdSet(["a", "a"], ["a", "b"])).toBe(false);
    expect(sameIdSet(["a", "x"], ["a", "b"])).toBe(false);
  });
});
