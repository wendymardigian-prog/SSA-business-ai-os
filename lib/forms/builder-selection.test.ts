import { describe, expect, it } from "vitest";
import { newField } from "./fields";
import { FORM_SELECTION, defaultEodSelection, normalizeSelection, selectedIndex, selectionAfterRemove } from "./builder-selection";

const a = newField("short_text", "a", "A");
const b = newField("email", "b", "B");

describe("seleccion del constructor", () => {
  it("una pregunta que ya no existe vuelve al formulario; una valida queda igual", () => {
    const sel = { kind: "field", id: a.id } as const;
    expect(normalizeSelection(sel, [a, b])).toBe(sel);
    expect(normalizeSelection(sel, [b])).toEqual(FORM_SELECTION);
    expect(normalizeSelection({ kind: "end" }, [])).toEqual({ kind: "end" });
  });

  it("el indice sale del id, no de la posicion", () => {
    expect(selectedIndex({ kind: "field", id: b.id }, [a, b])).toBe(1);
    expect(selectedIndex({ kind: "field", id: b.id }, [b, a])).toBe(0);
    expect(selectedIndex(FORM_SELECTION, [a, b])).toBe(-1);
  });

  it("al borrar queda la que ocupa el lugar, o la de arriba si era la ultima, o el formulario", () => {
    expect(selectionAfterRemove([b], 0)).toEqual({ kind: "field", id: b.id });
    expect(selectionAfterRemove([a], 1)).toEqual({ kind: "field", id: a.id });
    expect(selectionAfterRemove([], 0)).toEqual(FORM_SELECTION);
  });

  it("un reporte de fin de dia arranca en su primera pregunta", () => {
    expect(defaultEodSelection([a, b])).toEqual({ kind: "field", id: a.id });
    expect(defaultEodSelection([])).toEqual(FORM_SELECTION);
  });
});
