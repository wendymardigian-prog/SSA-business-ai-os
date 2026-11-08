import { describe, expect, it } from "vitest";
import { begin, cancel, canRedo, canUndo, COALESCE_WINDOW_MS, commit, createHistory, HISTORY_LIMIT, push, redo, reset, undo } from "./history";

describe("deshacer y rehacer (F26)", () => {
  it("deshacer un arrastre vuelve a la posición previa con UN solo paso", () => {
    // Un arrastre: se abre la transacción, llegan 30 movimientos intermedios y se suelta.
    let h = createHistory({ x: 10 });
    h = begin(h);
    for (let x = 11; x <= 40; x++) h = push(h, { x });
    expect(h.present).toEqual({ x: 40 });
    h = commit(h);
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present).toEqual({ x: 10 });
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toEqual({ x: 40 });
  });

  it("un arrastre que no movió nada no deja ningún paso", () => {
    let h = createHistory({ x: 10 });
    h = begin(h);
    h = commit(h);
    expect(h.past).toHaveLength(0);
    expect(canUndo(h)).toBe(false);
  });

  it("cancelar una transacción (Esc) vuelve a lo de antes sin dejar pasos", () => {
    let h = begin(createHistory({ x: 1 }));
    h = push(h, { x: 99 });
    h = cancel(h);
    expect(h.present).toEqual({ x: 1 });
    expect(h.transaction).toBeNull();
    expect(h.past).toHaveLength(0);
  });

  it("deshacer en medio de un arrastre lo cierra y lo deshace", () => {
    let h = begin(createHistory({ x: 1 }));
    h = push(h, { x: 5 });
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toEqual({ x: 1 });
    expect(h.transaction).toBeNull();
  });

  it("cada cambio suelto es un paso, y un cambio nuevo borra lo que se podía rehacer", () => {
    let h = createHistory(0);
    h = push(h, 1);
    h = push(h, 2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = push(h, 7);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe(7);
    expect(undo(undo(h)).present).toBe(0);
  });

  it("un cambio igual al actual no agrega un paso", () => {
    const doc = { a: 1 };
    const h = createHistory(doc);
    expect(push(h, doc)).toBe(h);
  });

  it("guarda los últimos 100 cambios y nada más", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 150; i++) h = push(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < 200; i++) h = undo(h);
    expect(h.present).toBe(50);
    expect(canUndo(h)).toBe(false);
    for (let i = 0; i < 200; i++) h = redo(h);
    expect(h.present).toBe(150);
  });

  it("escribir de corrido (misma clave, ventana corta) es un solo paso; pasada la ventana, otro", () => {
    let h = createHistory("");
    h = push(h, "H", { coalesce: "texto:el_a", now: 0 });
    h = push(h, "Ho", { coalesce: "texto:el_a", now: 300 });
    h = push(h, "Hol", { coalesce: "texto:el_a", now: 700 });
    expect(h.past).toEqual([""]);
    h = push(h, "Hola", { coalesce: "texto:el_a", now: 700 + COALESCE_WINDOW_MS + 1 });
    expect(h.past).toEqual(["", "Hol"]);
    // Otra clave nunca se junta.
    h = push(h, "Hola!", { coalesce: "texto:el_b", now: 800 + COALESCE_WINDOW_MS });
    expect(h.past).toHaveLength(3);
    expect(undo(h).present).toBe("Hola");
  });

  it("reset empieza de cero", () => {
    const h = reset("nuevo");
    expect(h.past).toEqual([]);
    expect(h.present).toBe("nuevo");
  });
});
