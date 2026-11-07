import { describe, expect, it } from "vitest";
import { emptyDoc, parseDesignDoc, type DesignDoc, type DesignElement } from "../doc/schema";
import { addElement, alignElements, allElementIds, boxOf, DUPLICATE_OFFSET, duplicateElements, estimateTextHeightPct, patchElement, patchElements, removeElements, replaceElement, unionBox } from "./doc-ops";

const text = (id: string, extra: Record<string, unknown> = {}): DesignElement =>
  ({ id, type: "text", x: 50, y: 50, w: 40, text: "Hola", font: { family: "Inter", weight: 400 }, size: 40, align: "left", color: "#111111", ...extra }) as DesignElement;
const shape = (id: string, extra: Record<string, unknown> = {}): DesignElement => ({ id, type: "shape", x: 30, y: 30, w: 20, h: 20, shape: "rect", fill: "#000000", ...extra }) as DesignElement;

const docWith = (...elements: DesignElement[]): DesignDoc => {
  const doc = emptyDoc("v45");
  doc.pages[0].elements = elements;
  return doc;
};

describe("operaciones del documento (F18–F25)", () => {
  it("cambia un elemento y deja igual (misma identidad) lo que no cambió", () => {
    const doc = docWith(text("el_aaaa01"), shape("el_bbbb01"));
    const next = patchElement(doc, 0, "el_aaaa01", { x: 10 });
    expect(next.pages[0].elements[0]).toMatchObject({ x: 10 });
    expect(next.pages[0].elements[1]).toBe(doc.pages[0].elements[1]);
    expect(patchElement(doc, 0, "el_aaaa01", { x: 50 })).toBe(doc);
    expect(patchElement(doc, 0, "no_existe", { x: 1 })).toBe(doc);
    expect(patchElement(doc, 5, "el_aaaa01", { x: 1 })).toBe(doc);
  });

  it("cambia varios elementos de una vez", () => {
    const doc = docWith(text("el_aaaa01"), shape("el_bbbb01"));
    const next = patchElements(doc, 0, { el_aaaa01: { y: 20 }, el_bbbb01: { x: 5, y: 6 } });
    expect(next.pages[0].elements.map((e) => [e.x, e.y])).toEqual([
      [50, 20],
      [5, 6],
    ]);
  });

  it("agrega adelante de todos, reemplaza y borra", () => {
    let doc = docWith(text("el_aaaa01"));
    doc = addElement(doc, 0, shape("el_bbbb01"));
    expect(doc.pages[0].elements.map((e) => e.id)).toEqual(["el_aaaa01", "el_bbbb01"]);
    doc = replaceElement(doc, 0, { ...(doc.pages[0].elements[1] as DesignElement), opacity: 0.5 });
    expect(doc.pages[0].elements[1].opacity).toBe(0.5);
    doc = removeElements(doc, 0, ["el_aaaa01"]);
    expect(doc.pages[0].elements.map((e) => e.id)).toEqual(["el_bbbb01"]);
    expect(removeElements(doc, 0, [])).toBe(doc);
    expect(removeElements(doc, 0, ["otro"])).toBe(doc);
  });

  it("duplica con ids nuevos, corrido, adelante del original y desbloqueado", () => {
    const doc = docWith(text("el_aaaa01", { locked: true, x: 98 }), shape("el_bbbb01"));
    const { doc: next, ids } = duplicateElements(doc, 0, ["el_aaaa01"]);
    expect(ids).toHaveLength(1);
    const [original, copy] = next.pages[0].elements;
    expect(original.id).toBe("el_aaaa01");
    expect(copy.id).toBe(ids[0]);
    expect(copy.id).not.toBe(original.id);
    expect(copy.x).toBe(100); // 98 + 3 se queda en el borde
    expect(copy.y).toBe(50 + DUPLICATE_OFFSET);
    expect(copy.locked).toBeUndefined();
    expect(new Set(allElementIds(next)).size).toBe(3);
    expect(parseDesignDoc(next).ok).toBe(true);
    expect(duplicateElements(doc, 0, ["nada"]).ids).toEqual([]);
  });

  it("la caja de un texto usa el alto medido o, si no, una estimación que crece con los renglones", () => {
    const doc = docWith(text("el_aaaa01"));
    const el = doc.pages[0].elements[0];
    expect(boxOf(el, doc, 0, 12).h).toBe(12);
    const short = estimateTextHeightPct(text("el_x") as never, doc, 0);
    const long = estimateTextHeightPct(text("el_y", { text: "x".repeat(400) }) as never, doc, 0);
    expect(long).toBeGreaterThan(short);
    expect(boxOf(shape("el_s"), doc, 0).h).toBe(20);
  });

  it("la caja que envuelve a un grupo", () => {
    expect(unionBox([])).toBeNull();
    expect(unionBox([{ x: 20, y: 20, w: 20, h: 20 }, { x: 80, y: 60, w: 20, h: 20 }])).toEqual({ x: 50, y: 40, w: 80, h: 60 });
  });

  it("alinear a la página mueve cada elemento y no toca lo bloqueado", () => {
    const doc = docWith(shape("el_aaaa01", { w: 20 }), shape("el_bbbb01", { locked: true }), text("el_cccc01"));
    const left = alignElements(doc, 0, ["el_aaaa01", "el_bbbb01"], "left");
    expect(left.pages[0].elements[0].x).toBe(10);
    expect(left.pages[0].elements[1].x).toBe(30);
    const center = alignElements(doc, 0, ["el_aaaa01"], "center");
    expect(center.pages[0].elements[0].x).toBe(50);
    const bottom = alignElements(doc, 0, ["el_cccc01"], "bottom", { el_cccc01: 10 });
    expect(bottom.pages[0].elements[2].y).toBe(95);
    expect(alignElements(doc, 0, ["el_bbbb01"], "left")).toBe(doc);
  });
});
