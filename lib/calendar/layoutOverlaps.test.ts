import { describe, expect, it } from "vitest";
import { layoutOverlaps, type Span } from "./layoutOverlaps";

const s = (id: string, start: number, end: number): Span => ({ id, start, end });
const cols = (spans: Span[]) => layoutOverlaps(spans).map((p) => [p.id, p.column, p.columns]);

describe("layoutOverlaps (R7)", () => {
  it("sin superposicion: cada uno ocupa todo el ancho", () => {
    expect(cols([s("a", 540, 600), s("b", 600, 660), s("c", 700, 760)])).toEqual([["a", 0, 1], ["b", 0, 1], ["c", 0, 1]]);
  });
  it("dos que se pisan van lado a lado", () => {
    expect(cols([s("a", 540, 630), s("b", 570, 600)])).toEqual([["a", 0, 2], ["b", 1, 2]]);
  });
  it("una agenda y dos tareas en el mismo horario: tres columnas (el que empieza antes o termina antes va primero)", () => {
    expect(cols([s("agenda", 540, 600), s("t1", 540, 570), s("t2", 550, 580)])).toEqual([["agenda", 1, 3], ["t1", 0, 3], ["t2", 2, 3]]);
  });
  it("reusa la primera columna libre: A y C no se pisan, comparten columna; B va al lado", () => {
    expect(cols([s("A", 540, 600), s("B", 560, 640), s("C", 600, 660)])).toEqual([["A", 0, 2], ["B", 1, 2], ["C", 0, 2]]);
  });
  it("grupos separados no se afectan entre si", () => {
    expect(cols([s("a", 540, 600), s("b", 560, 580), s("c", 800, 860)])).toEqual([["a", 0, 2], ["b", 1, 2], ["c", 0, 1]]);
  });
  it("conserva el orden de entrada aunque lleguen desordenados", () => {
    expect(layoutOverlaps([s("tarde", 800, 830), s("temprano", 540, 570)]).map((p) => p.id)).toEqual(["tarde", "temprano"]);
  });
  it("lo que dura poco ocupa su altura minima: dos de 5 minutos seguidos se pisan si la tarjeta mide 30", () => {
    expect(cols([s("a", 540, 545), s("b", 550, 555)])).toEqual([["a", 0, 2], ["b", 1, 2]]);
    expect(layoutOverlaps([s("a", 540, 545), s("b", 550, 555)], 5).map((p) => p.columns)).toEqual([1, 1]);
  });
  it("sin nada devuelve vacio y no cambia lo que recibe", () => {
    const input = [s("a", 1, 2)];
    const copy = JSON.stringify(input);
    expect(layoutOverlaps([])).toEqual([]);
    layoutOverlaps(input);
    expect(JSON.stringify(input)).toBe(copy);
  });
});
