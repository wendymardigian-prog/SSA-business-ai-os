import { describe, expect, it } from "vitest";
import { emptyDoc, parseDesignDoc, type DesignDoc, type DesignElement } from "../doc/schema";
import { MAX_PAGES } from "../formats";
import { allElementIds } from "./doc-ops";
import { addPage, addPageBlockedReason, canAddPage, canDeletePage, clampPageIndex, deletePage, duplicatePage, followSelected, hasPageStrip, movePage, pageLabel, pageMenuActions } from "./pages";

const el = (id: string): DesignElement => ({ id, type: "text", x: 50, y: 50, w: 40, text: "Hola", font: { family: "Inter", weight: 400 }, size: 40, align: "left", color: "#111111" });

function docOf(count: number, format: DesignDoc["format"] = "v45"): DesignDoc {
  const doc = emptyDoc(format, "#112233");
  while (doc.pages.length < count) doc.pages.push({ ...structuredClone(doc.pages[0]), id: `pg_extra${String(doc.pages.length).padStart(2, "0")}` });
  doc.pages.forEach((page, i) => (page.elements = [el(`el_p${i}a001`), el(`el_p${i}b001`)]));
  return doc;
}

describe("páginas (F25)", () => {
  it("duplicar copia los elementos con ids NUEVOS y deja la copia justo después", () => {
    const doc = docOf(3);
    const { doc: next, index } = duplicatePage(doc, 1);
    expect(next.pages).toHaveLength(4);
    expect(index).toBe(2);
    const copy = next.pages[2];
    expect(copy.id).not.toBe(doc.pages[1].id);
    expect(copy.elements).toHaveLength(2);
    const originalIds = doc.pages[1].elements.map((e) => e.id);
    for (const e of copy.elements) expect(originalIds).not.toContain(e.id);
    expect(new Set(allElementIds(next)).size).toBe(8);
    // El contenido es el mismo.
    expect(copy.elements.map((e) => (e as { text: string }).text)).toEqual(["Hola", "Hola"]);
    expect(parseDesignDoc(next).ok).toBe(true);
    // Lo copiado no comparte referencias con el original.
    expect(copy.background).not.toBe(doc.pages[1].background);
  });

  it("eliminar la última página que queda no deja el documento sin páginas", () => {
    const doc = docOf(1);
    expect(canDeletePage(doc)).toBe(false);
    expect(deletePage(doc, 0).doc).toBe(doc);
    expect(deletePage(doc, 0).doc.pages).toHaveLength(1);
  });

  it("eliminar una página deja seleccionada la misma posición, o la anterior si era la última", () => {
    const doc = docOf(3);
    expect(deletePage(doc, 1)).toMatchObject({ index: 1 });
    expect(deletePage(doc, 1).doc.pages.map((p) => p.id)).toEqual([doc.pages[0].id, doc.pages[2].id]);
    expect(deletePage(doc, 2).index).toBe(1);
    expect(deletePage(doc, 0).index).toBe(0);
  });

  it("«+» agrega una página en blanco con el fondo de la anterior", () => {
    const doc = docOf(2);
    doc.pages[1].background = { type: "image", color: "#112233", image: { asset: "ws/images/a.png", fit: "cover", focal: { x: 50, y: 50 }, locked: true }, overlay: { color: "#000000", opacity: 0.4 } };
    const { doc: next, index } = addPage(doc);
    expect(index).toBe(2);
    expect(next.pages[2].elements).toEqual([]);
    expect(next.pages[2].background).toEqual(doc.pages[1].background);
    expect(next.pages[2].id).not.toBe(doc.pages[1].id);
    expect(parseDesignDoc(next).ok).toBe(true);
  });

  it("el máximo son 20 páginas", () => {
    const full = docOf(MAX_PAGES);
    expect(canAddPage(full)).toBe(false);
    expect(addPage(full).doc).toBe(full);
    expect(duplicatePage(full, 0).doc).toBe(full);
    expect(addPageBlockedReason(full)).toContain("20");
    expect(canAddPage(docOf(MAX_PAGES - 1))).toBe(true);
  });

  it("una página web no tiene tira: una sola página, sin «+»", () => {
    const web = docOf(1, "web");
    expect(hasPageStrip(web)).toBe(false);
    expect(canAddPage(web)).toBe(false);
    expect(addPage(web).doc).toBe(web);
    expect(addPageBlockedReason(web)).toContain("una sola página");
    expect(hasPageStrip(docOf(1, "wide"))).toBe(true);
  });

  it("mover reordena sin perder ni repetir páginas", () => {
    const doc = docOf(4);
    const ids = doc.pages.map((p) => p.id);
    expect(movePage(doc, 0, 3).doc.pages.map((p) => p.id)).toEqual([ids[1], ids[2], ids[3], ids[0]]);
    expect(movePage(doc, 3, 0).doc.pages.map((p) => p.id)).toEqual([ids[3], ids[0], ids[1], ids[2]]);
    expect(movePage(doc, 2, 2).doc).toBe(doc);
    expect(movePage(doc, 9, -4).doc.pages).toHaveLength(4);
  });

  it("la página que se miraba sigue a su página cuando se mueve otra", () => {
    expect(followSelected(2, 2, 0)).toBe(0);
    expect(followSelected(1, 0, 3)).toBe(0);
    expect(followSelected(2, 3, 0)).toBe(3);
    expect(followSelected(0, 2, 3)).toBe(0);
  });

  it("el menú de cada página dice qué se puede y por qué no", () => {
    const doc = docOf(2);
    const [dup, left, right, del] = pageMenuActions(doc, 0);
    expect(dup.enabled).toBe(true);
    expect(left).toMatchObject({ enabled: false, reason: "Ya es la primera." });
    expect(right.enabled).toBe(true);
    expect(del.enabled).toBe(true);
    expect(pageMenuActions(docOf(1), 0).find((a) => a.id === "delete")).toMatchObject({ enabled: false });
    expect(pageMenuActions(docOf(MAX_PAGES), 0).find((a) => a.id === "duplicate")?.enabled).toBe(false);
  });

  it("el índice nunca queda fuera del documento y la página tiene rótulo", () => {
    const doc = docOf(3);
    expect(clampPageIndex(doc, 99)).toBe(2);
    expect(clampPageIndex(doc, -5)).toBe(0);
    expect(pageLabel(doc, 1)).toBe("Página 2");
    doc.pages[1].name = "Portada";
    expect(pageLabel(doc, 1)).toBe("Portada");
  });
});
