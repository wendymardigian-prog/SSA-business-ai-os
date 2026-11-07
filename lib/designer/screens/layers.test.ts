import { describe, expect, it } from "vitest";
import { emptyDoc, type DesignDoc, type DesignElement } from "../doc/schema";
import { renderPageHTML } from "../render/page-html";
import {
  applyOrder,
  bringForward,
  bringToFront,
  layerName,
  layerRows,
  moveToRow,
  orderAvailability,
  renameLayer,
  reorder,
  sameElements,
  sendBackward,
  sendToBack,
  toggleHidden,
  toggleLocked,
} from "./layers";

const text = (id: string, t = "Hola", extra: Record<string, unknown> = {}): DesignElement =>
  ({ id, type: "text", x: 50, y: 50, w: 40, text: t, font: { family: "Inter", weight: 400 }, size: 40, align: "left", color: "#111111", ...extra }) as DesignElement;
const shape = (id: string): DesignElement => ({ id, type: "shape", x: 30, y: 30, w: 20, h: 20, shape: "rect", fill: "#000000" });
const image = (id: string, asset = "ws/images/foto-1.png"): DesignElement => ({ id, type: "image", x: 50, y: 50, w: 30, h: 30, asset, fit: "cover" });

const four = () => [text("el_a"), shape("el_b"), image("el_c"), text("el_d", "Otro")];
const ids = (els: readonly DesignElement[]) => els.map((e) => e.id);

describe("capas (F20)", () => {
  it("la lista muestra el elemento de más adelante arriba", () => {
    expect(layerRows(four()).map((r) => r.id)).toEqual(["el_d", "el_c", "el_b", "el_a"]);
    expect(layerRows(four())[0]).toMatchObject({ index: 3, type: "text" });
  });

  it("el nombre se deriva: texto con variables entre corchetes, nombre del archivo o «Forma»", () => {
    const label = (key: string) => (key === "contact.display_name" ? "Nombre completo" : key);
    expect(layerName(text("el_a", "Hola {{contact.display_name}}"), label)).toBe("Hola [Nombre completo]");
    expect(layerName(image("el_i", "ws/images/portada.png"))).toBe("portada.png");
    expect(layerName(shape("el_s"))).toBe("Forma");
    expect(layerName({ ...shape("el_s"), shape: "circle" } as DesignElement)).toBe("Círculo");
    expect(layerName(text("el_a", "x".repeat(60)))).toBe(`${"x".repeat(40)}…`);
    expect(layerName(text("el_a", "  "))).toBe("Texto");
    expect(layerName(text("el_a", "Hola", { name: "Título" }))).toBe("Título");
  });

  it("las cuatro acciones de orden dejan un orden válido (los mismos elementos, sin repetir)", () => {
    for (const id of ["el_a", "el_b", "el_c", "el_d"]) {
      for (const action of ["front", "forward", "backward", "back"] as const) {
        const next = applyOrder(four(), id, action);
        expect(sameElements(four(), next), `${action} ${id}`).toBe(true);
      }
    }
  });

  it("traer al frente, adelante, atrás y al fondo", () => {
    expect(ids(bringToFront(four(), "el_a"))).toEqual(["el_b", "el_c", "el_d", "el_a"]);
    expect(ids(bringForward(four(), "el_b"))).toEqual(["el_a", "el_c", "el_b", "el_d"]);
    expect(ids(sendBackward(four(), "el_c"))).toEqual(["el_a", "el_c", "el_b", "el_d"]);
    expect(ids(sendToBack(four(), "el_d"))).toEqual(["el_d", "el_a", "el_b", "el_c"]);
  });

  it("en los extremos no cambia nada (mismo arreglo)", () => {
    const els = four();
    expect(bringToFront(els, "el_d")).toBe(els);
    expect(bringForward(els, "el_d")).toBe(els);
    expect(sendBackward(els, "el_a")).toBe(els);
    expect(sendToBack(els, "el_a")).toBe(els);
    expect(bringToFront(els, "no_existe")).toBe(els);
  });

  it("qué órdenes tienen sentido", () => {
    expect(orderAvailability(four(), "el_d")).toEqual({ front: false, forward: false, backward: true, back: true });
    expect(orderAvailability(four(), "el_a")).toEqual({ front: true, forward: true, backward: false, back: false });
  });

  it("reordenar (arrastrar y soltar) por posición del arreglo y por fila de la lista", () => {
    expect(ids(reorder(four(), 0, 3))).toEqual(["el_b", "el_c", "el_d", "el_a"]);
    expect(ids(reorder(four(), 3, 99))).toEqual(["el_a", "el_b", "el_c", "el_d"]);
    // Fila 0 de la lista = el de más adelante.
    expect(ids(moveToRow(four(), "el_a", 0))).toEqual(["el_b", "el_c", "el_d", "el_a"]);
    expect(ids(moveToRow(four(), "el_d", 3))).toEqual(["el_d", "el_a", "el_b", "el_c"]);
    for (let row = -2; row < 8; row++) expect(sameElements(four(), moveToRow(four(), "el_b", row))).toBe(true);
  });

  it("ocultar y bloquear no cambian el orden", () => {
    let els = four();
    els = toggleHidden(els, "el_b");
    els = toggleLocked(els, "el_c");
    expect(ids(els)).toEqual(ids(four()));
    expect(els[1].hidden).toBe(true);
    expect(els[2].locked).toBe(true);
    els = toggleHidden(toggleLocked(els, "el_c"), "el_b");
    expect(els[1]).not.toHaveProperty("hidden");
    expect(els[2]).not.toHaveProperty("locked");
  });

  it("un oculto no sale en public ni en export (sí en edit, atenuado, si se pide)", () => {
    const doc: DesignDoc = { ...emptyDoc("v45"), pages: [{ ...emptyDoc("v45").pages[0], elements: toggleHidden(four(), "el_a") }] };
    const assetUrl = (p: string) => `https://s.test/${p}`;
    for (const mode of ["public", "export"] as const) {
      const html = renderPageHTML(doc, 0, { mode, assetUrl });
      expect(html).not.toContain('data-el="el_a"');
      expect(html).toContain('data-el="el_b"');
    }
    expect(renderPageHTML(doc, 0, { mode: "edit", assetUrl })).not.toContain('data-el="el_a"');
    expect(renderPageHTML(doc, 0, { mode: "edit", assetUrl, showHidden: true })).toContain('data-el="el_a"');
  });

  it("renombrar; un nombre vacío vuelve al derivado", () => {
    let els = renameLayer(four(), "el_a", "  Mi   título ");
    expect(els[0].name).toBe("Mi título");
    els = renameLayer(els, "el_a", "   ");
    expect(els[0]).not.toHaveProperty("name");
  });
});
