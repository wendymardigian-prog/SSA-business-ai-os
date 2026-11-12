import { describe, expect, it } from "vitest";
import type { DesignElement } from "../doc/schema";
import {
  canEditText,
  canMove,
  clear,
  clickElement,
  dragGroup,
  EMPTY_SELECTION,
  movableIds,
  reconcile,
  selectAll,
  selectHtmlText,
  selectOnly,
  selectRect,
  soleSelected,
  startEditing,
  stopEditing,
  toggle,
  type SelectableBox,
} from "./selection";

const text = (id: string, extra: Partial<Extract<DesignElement, { type: "text" }>> = {}): DesignElement => ({
  id,
  type: "text",
  x: 50,
  y: 50,
  w: 40,
  text: "Hola",
  font: { family: "Inter", weight: 400 },
  size: 40,
  align: "left",
  color: "#111111",
  ...extra,
});
const shape = (id: string, extra: Partial<Extract<DesignElement, { type: "shape" }>> = {}): DesignElement => ({ id, type: "shape", x: 50, y: 50, w: 20, h: 20, shape: "rect", fill: "#000000", ...extra });

describe("selección del lienzo (F18)", () => {
  it("un clic selecciona un elemento; otro clic cambia la selección; un clic en vacío la limpia", () => {
    let s = selectOnly(EMPTY_SELECTION, "el_a");
    expect(s.ids).toEqual(["el_a"]);
    s = clickElement(s, "el_b", false);
    expect(s.ids).toEqual(["el_b"]);
    expect(clear(s)).toEqual(EMPTY_SELECTION);
    expect(clear(EMPTY_SELECTION)).toBe(EMPTY_SELECTION);
  });

  it("Shift+clic suma y saca", () => {
    let s = selectOnly(EMPTY_SELECTION, "el_a");
    s = clickElement(s, "el_b", true);
    expect(s.ids).toEqual(["el_a", "el_b"]);
    s = clickElement(s, "el_a", true);
    expect(s.ids).toEqual(["el_b"]);
    expect(toggle(s, "el_c").ids).toEqual(["el_b", "el_c"]);
  });

  it("el rectángulo selecciona lo que toca y no lo oculto; con Shift suma a lo que había", () => {
    const items: SelectableBox[] = [
      { id: "el_a", box: { x: 20, y: 20, w: 10, h: 10 } },
      { id: "el_b", box: { x: 80, y: 80, w: 10, h: 10 } },
      { id: "el_c", box: { x: 22, y: 22, w: 10, h: 10 }, hidden: true },
    ];
    const rect = { x: 25, y: 25, w: 40, h: 40 };
    expect(selectRect(EMPTY_SELECTION, items, rect).ids).toEqual(["el_a"]);
    expect(selectRect({ ids: ["el_b"], editing: null }, items, rect, true).ids).toEqual(["el_b", "el_a"]);
    expect(selectRect({ ids: ["el_b"], editing: null }, items, rect, false).ids).toEqual(["el_a"]);
    expect(selectRect(EMPTY_SELECTION, items, { x: 5, y: 95, w: 4, h: 4 }).ids).toEqual([]);
    expect(selectAll(items).ids).toEqual(["el_a", "el_b"]);
  });

  it("un elemento bloqueado se selecciona pero no se mueve ni se edita", () => {
    const locked = text("el_l", { locked: true });
    const free = text("el_f");
    const s = toggle(selectOnly(EMPTY_SELECTION, "el_l"), "el_f");
    expect(s.ids).toEqual(["el_l", "el_f"]);
    expect(canMove(locked)).toBe(false);
    expect(canEditText(locked)).toBe(false);
    expect(movableIds(s, [locked, free])).toEqual(["el_f"]);
    expect(startEditing(selectOnly(EMPTY_SELECTION, "el_l"), locked).editing).toBeNull();
  });

  it("doble clic o Enter entra a escribir solo en un texto; Esc sale y lo deja seleccionado", () => {
    const t = text("el_t");
    let s = startEditing(selectOnly(EMPTY_SELECTION, "el_t"), t);
    expect(s).toEqual({ ids: ["el_t"], editing: "el_t" });
    s = stopEditing(s);
    expect(s).toEqual({ ids: ["el_t"], editing: null });
    // Una forma o una imagen no se escriben.
    expect(startEditing(selectOnly(EMPTY_SELECTION, "el_s"), shape("el_s")).editing).toBeNull();
    // Escribir deja solo ese texto seleccionado.
    expect(startEditing({ ids: ["el_t", "el_x"], editing: null }, t).ids).toEqual(["el_t"]);
  });

  it("cambiar la selección mientras se escribe sale de escribir", () => {
    const writing = startEditing(EMPTY_SELECTION, text("el_t"));
    expect(clickElement(writing, "el_b", false).editing).toBeNull();
    expect(toggle(writing, "el_b").editing).toBeNull();
  });

  it("al borrar o cambiar de página se saca lo que ya no está", () => {
    const s = { ids: ["el_a", "el_gone"], editing: "el_gone" };
    expect(reconcile(s, [{ id: "el_a" }])).toEqual({ ids: ["el_a"], editing: null });
    const same = { ids: ["el_a"], editing: null };
    expect(reconcile(same, [{ id: "el_a" }])).toBe(same);
  });

  it("la barra del elemento es solo para una selección de uno", () => {
    expect(soleSelected({ ids: ["el_a"], editing: null })).toBe("el_a");
    expect(soleSelected({ ids: ["el_a", "el_b"], editing: null })).toBeNull();
    expect(soleSelected(EMPTY_SELECTION)).toBeNull();
  });

  it("al arrastrar un elemento que ya está en el grupo se mueve todo el grupo", () => {
    const s = { ids: ["el_a", "el_b"], editing: null };
    expect(dragGroup(s, "el_b")).toEqual(["el_a", "el_b"]);
    expect(dragGroup(s, "el_z")).toEqual(["el_z"]);
  });
});

describe("un texto de adentro de un HTML cargado", () => {
  const html = { id: "h", type: "html" as const, locked: false, hidden: false };

  it("elegirlo deja el bloque como única selección, con ese texto", () => {
    const next = selectHtmlText({ ids: ["a", "b"], editing: null }, "h", "tx2");
    expect(next).toEqual({ ids: ["h"], editing: null, text: { el: "h", tx: "tx2" } });
    expect(selectHtmlText(next, "h", "tx2")).toBe(next);
  });

  it("doble clic escribe el texto elegido; sin texto elegido, no hace nada", () => {
    const chosen = selectHtmlText(EMPTY_SELECTION, "h", "tx2");
    expect(startEditing(chosen, html)).toEqual({ ids: ["h"], editing: "h", text: { el: "h", tx: "tx2" } });
    const whole = selectOnly(EMPTY_SELECTION, "h");
    expect(startEditing(whole, html)).toBe(whole);
  });

  it("un bloque bloqueado u oculto no se escribe", () => {
    const chosen = selectHtmlText(EMPTY_SELECTION, "h", "tx2");
    expect(startEditing(chosen, { ...html, locked: true })).toBe(chosen);
    expect(startEditing(chosen, { ...html, hidden: true })).toBe(chosen);
  });

  it("Esc sale de escribir y deja el texto elegido; tocar otra cosa lo suelta", () => {
    const editing = startEditing(selectHtmlText(EMPTY_SELECTION, "h", "tx2"), html);
    expect(stopEditing(editing)).toEqual({ ids: ["h"], editing: null, text: { el: "h", tx: "tx2" } });
    expect(selectOnly(editing, "otro").text).toBeUndefined();
    expect(reconcile(editing, [{ id: "otro" }])).toEqual({ ids: [], editing: null });
  });
});
