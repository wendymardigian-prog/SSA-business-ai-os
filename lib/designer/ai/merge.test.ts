import { describe, expect, it } from "vitest";
import type { DesignDoc, DesignPage, TextElement } from "../doc/schema";
import { keptManualNotice, mergeAiPatch, mergeOrder } from "./merge";
import { carousel, page, textEl } from "./test-fixtures";

const clone = (doc: DesignDoc): DesignDoc => structuredClone(doc);
const el = (doc: DesignDoc, pageIdx: number, id: string): TextElement => doc.pages[pageIdx].elements.find((e) => e.id === id) as TextElement;

describe("ai/merge: mergeAiPatch(base, mine, ai)", () => {
  it("si solo cambió la IA, queda lo de la IA", () => {
    const base = carousel();
    const ai = clone(base);
    el(ai, 0, "el_title01").size = 120;
    const r = mergeAiPatch(base, clone(base), ai);
    expect(el(r.doc, 0, "el_title01").size).toBe(120);
    expect(r.keptManual).toEqual([]);
  });

  it("si solo cambió la persona, queda lo de la persona", () => {
    const base = carousel();
    const mine = clone(base);
    el(mine, 1, "el_body001").text = "Escrito a mano";
    const r = mergeAiPatch(base, mine, clone(base));
    expect(el(r.doc, 1, "el_body001").text).toBe("Escrito a mano");
  });

  it("respeta los cambios manuales sobre el mismo elemento y aplica los demás", () => {
    const base = carousel();
    const mine = clone(base);
    el(mine, 0, "el_title01").text = "Mi título";
    const ai = clone(base);
    el(ai, 0, "el_title01").size = 120; // la IA tocó el mismo elemento
    el(ai, 2, "el_cta0001").size = 90; // y otro que la persona no tocó
    const r = mergeAiPatch(base, mine, ai);
    expect(el(r.doc, 0, "el_title01").text).toBe("Mi título");
    expect(el(r.doc, 0, "el_title01").size).toBe(64); // gana la persona: todo el elemento
    expect(el(r.doc, 2, "el_cta0001").size).toBe(90);
    expect(r.keptManual).toEqual(["el_title01"]);
    expect(keptManualNotice(r)).toMatch(/Dejé tu cambio manual/);
  });

  it("si los dos hicieron exactamente lo mismo no es un conflicto", () => {
    const base = carousel();
    const mine = clone(base);
    const ai = clone(base);
    el(mine, 0, "el_title01").size = 100;
    el(ai, 0, "el_title01").size = 100;
    const r = mergeAiPatch(base, mine, ai);
    expect(r.keptManual).toEqual([]);
    expect(el(r.doc, 0, "el_title01").size).toBe(100);
  });

  it("agrega lo que agregó la IA y conserva lo que agregó la persona", () => {
    const base = carousel();
    const mine = clone(base);
    mine.pages[1].elements.push(textEl("el_mio00001", "Mío", { y: 80 }));
    const ai = clone(base);
    ai.pages[1].elements.push(textEl("el_ia000001", "De la IA", { y: 20 }));
    const r = mergeAiPatch(base, mine, ai);
    expect(r.doc.pages[1].elements.map((e) => e.id)).toEqual(["el_body001", "el_ia000001", "el_mio00001"]);
  });

  it("lo que la IA quitó se quita, salvo que la persona lo haya tocado", () => {
    const base = carousel();
    const ai = clone(base);
    ai.pages[0].elements = ai.pages[0].elements.filter((e) => e.id !== "el_sub0001");
    const untouched = mergeAiPatch(base, clone(base), ai);
    expect(untouched.doc.pages[0].elements.map((e) => e.id)).toEqual(["el_title01"]);

    const mine = clone(base);
    el(mine, 0, "el_sub0001").text = "Lo edité yo";
    const touched = mergeAiPatch(base, mine, ai);
    expect(touched.doc.pages[0].elements.map((e) => e.id)).toContain("el_sub0001");
    expect(touched.keptManual).toEqual(["el_sub0001"]);
  });

  it("lo que la persona quitó queda quitado aunque la IA lo haya cambiado", () => {
    const base = carousel();
    const mine = clone(base);
    mine.pages[1].elements = [];
    const ai = clone(base);
    el(ai, 1, "el_body001").size = 99;
    const r = mergeAiPatch(base, mine, ai);
    expect(r.doc.pages[1].elements).toEqual([]);
  });

  it("páginas nuevas de la IA entran donde las puso; el orden de la persona gana si lo movió", () => {
    const base = carousel();
    const ai = clone(base);
    ai.pages.splice(2, 0, page("pg_nueva001", [textEl("el_nueva001", "Testimonio")]));
    const r = mergeAiPatch(base, clone(base), ai);
    expect(r.doc.pages.map((p) => p.id)).toEqual(["pg_cover01", "pg_body001", "pg_nueva001", "pg_cta0001"]);

    const mine = clone(base);
    mine.pages = [mine.pages[1], mine.pages[0], mine.pages[2]];
    const r2 = mergeAiPatch(base, mine, ai);
    // Su orden manda (cuerpo, portada, cierre); la página nueva entra detrás de la que la antecedía en la versión de la IA (el cuerpo).
    expect(r2.doc.pages.map((p) => p.id)).toEqual(["pg_body001", "pg_nueva001", "pg_cover01", "pg_cta0001"]);
  });

  it("una página que la persona editó no se pierde aunque la IA la haya quitado", () => {
    const base = carousel();
    const ai = clone(base);
    ai.pages = ai.pages.filter((p) => p.id !== "pg_body001");
    const mine = clone(base);
    el(mine, 1, "el_body001").text = "Importante";
    const r = mergeAiPatch(base, mine, ai);
    expect(r.doc.pages.map((p) => p.id)).toContain("pg_body001");
    expect(r.keptManualPages).toEqual(["página 2"]);
  });

  it("el fondo: si lo cambiaron los dos distinto, gana la persona y se avisa", () => {
    const base = carousel();
    const mine = clone(base);
    mine.pages[0].background = { type: "color", color: "#ff0000" };
    const ai = clone(base);
    ai.pages[0].background = { type: "color", color: "#00ff00" };
    const r = mergeAiPatch(base, mine, ai);
    expect(r.doc.pages[0].background.color).toBe("#ff0000");
    expect(r.keptManualPages).toEqual(["fondo de la página 1"]);
  });

  it("el estilo del documento sigue a la IA si la persona no lo tocó", () => {
    const base = carousel();
    const ai = clone(base);
    ai.style = "minimal";
    expect(mergeAiPatch(base, clone(base), ai).doc.style).toBe("minimal");
  });

  it("sin cambios de ninguno, devuelve lo mismo", () => {
    const base = carousel();
    const r = mergeAiPatch(base, clone(base), clone(base));
    expect(r.doc).toEqual(base);
    expect(keptManualNotice(r)).toBeNull();
  });

  it("primera versión: la página en blanco que la persona no tocó se reemplaza por las de la IA", () => {
    const base: DesignDoc = { v: 1, format: "v45", pages: [page("pg_blank001", [])] };
    const ai: DesignDoc = { v: 1, format: "v45", style: "social", pages: [page("pg_ia000001", [textEl("el_ia000001", "Hola")]), page("pg_ia000002", [textEl("el_ia000002", "Chau")])] };
    const r = mergeAiPatch(base, clone(base), ai);
    expect(r.doc.pages.map((p: DesignPage) => p.id)).toEqual(["pg_ia000001", "pg_ia000002"]);
  });

  it("mergeOrder: si la persona reordenó, su orden; si no, el de la IA", () => {
    const final = new Set(["a", "b", "c"]);
    expect(mergeOrder(["a", "b", "c"], ["a", "b", "c"], ["c", "a", "b"], final)).toEqual(["c", "a", "b"]);
    expect(mergeOrder(["a", "b", "c"], ["b", "a", "c"], ["c", "a", "b"], final)).toEqual(["b", "a", "c"]);
  });
});
