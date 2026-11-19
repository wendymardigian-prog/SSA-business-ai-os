import { describe, expect, it } from "vitest";
import { keepVisible, selectionState, toggleAllVisible, toggleRow } from "./selection";

describe("selección de filas de DataTable", () => {
  it("el estado de la casilla del encabezado mira solo las filas a la vista", () => {
    expect(selectionState(new Set(), ["a", "b"])).toBe("none");
    expect(selectionState(new Set(["a"]), ["a", "b"])).toBe("some");
    expect(selectionState(new Set(["a", "b", "z"]), ["a", "b"])).toBe("all");
    expect(selectionState(new Set(["a"]), [])).toBe("none");
  });

  it("prender y apagar una fila no toca el conjunto original", () => {
    const start = new Set(["a"]);
    expect([...toggleRow(start, "b")].sort()).toEqual(["a", "b"]);
    expect([...toggleRow(start, "a")]).toEqual([]);
    expect([...start]).toEqual(["a"]);
  });

  it("la casilla del encabezado suma todas las de la vista, o las saca si ya estaban", () => {
    expect([...toggleAllVisible(new Set(["a"]), ["a", "b"])].sort()).toEqual(["a", "b"]);
    expect([...toggleAllVisible(new Set(["a", "b", "z"]), ["a", "b"])]).toEqual(["z"]);
  });

  it("lo que dejó de verse se suelta", () => {
    expect([...keepVisible(new Set(["a", "z"]), ["a", "b"])]).toEqual(["a"]);
  });
});
