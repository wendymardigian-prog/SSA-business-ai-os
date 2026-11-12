import { describe, expect, it } from "vitest";
import { capacityRows, overCapacityNote, parseCapacityInput, readCapacity } from "./capacity";

describe("reparto de clientes (A4, F151)", () => {
  it("lee solo topes válidos", () => {
    expect(readCapacity({ capacity: { a: 5, b: 0, c: "x", d: 1001, e: 20 } })).toEqual({ a: 5, e: 20 });
    expect(readCapacity(null)).toEqual({});
  });
  it("arma las filas con «N de M» y quién está lleno", () => {
    const rows = capacityRows([{ id: "a", name: "Ana" }, { id: "b", name: "Beto" }], { a: 3 }, { a: 3, b: 7 });
    expect(rows).toEqual([
      { id: "a", name: "Ana", cap: 3, load: 3, label: "3 de 3", full: true },
      { id: "b", name: "Beto", cap: null, load: 7, label: "7", full: false },
    ]);
  });
  it("valida lo escrito: vacío = sin tope, 1..1000, ignora a quien no es del equipo", () => {
    expect(parseCapacityInput({ a: "10", b: "", z: "5" }, ["a", "b"])).toEqual({ ok: true, capacity: { a: 10 } });
    expect(parseCapacityInput({ a: "0" }, ["a"]).ok).toBe(false);
    expect(parseCapacityInput({ a: "2.5" }, ["a"]).ok).toBe(false);
  });
  it("avisa al asignar a mano por encima del tope", () => {
    expect(overCapacityNote("a", { a: 2 }, { a: 2 })).toBe("Supera su tope (2 de 2)");
    expect(overCapacityNote("a", { a: 2 }, { a: 1 })).toBeNull();
    expect(overCapacityNote("b", { a: 2 }, { b: 9 })).toBeNull();
  });
});
