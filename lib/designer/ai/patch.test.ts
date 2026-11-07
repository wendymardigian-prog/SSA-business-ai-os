import { describe, expect, it } from "vitest";
import { parseDesignDoc } from "../doc/schema";
import { applyPatch, changedPageIndexes, describeChange, lastPageIsCta } from "./patch";
import { parseAiPatch, type DesignPatch } from "./schema";
import { carousel, page, singlePage, textEl } from "./test-fixtures";

const patch = (json: unknown): DesignPatch => {
  const r = parseAiPatch(json);
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.value;
};

const newText = { type: "text", x: 50, y: 50, w: 80, text: "Nuevo", font: { family: "Inter", weight: 700 }, size: 60, align: "center", color: "#ffffff" };
const newPage = (text: string) => ({ background: { type: "color", color: "#101010" }, elements: [{ ...newText, text }] });

describe("ai/patch: aplicar un parche", () => {
  it("update cambia solo lo que se le dice y conserva id y tipo", () => {
    const doc = carousel();
    const r = applyPatch(doc, patch({ pages: [{ index: 0, ops: [{ op: "update", id: "el_title01", set: { size: 90, id: "el_otro", type: "shape" } }] }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const el = r.doc.pages[0].elements[0];
    expect(el.id).toBe("el_title01");
    expect(el.type).toBe("text");
    expect((el as { size: number }).size).toBe(90);
    expect(r.doc.pages[1]).toEqual(doc.pages[1]);
  });

  it("no modifica el documento original", () => {
    const doc = carousel();
    const copy = JSON.stringify(doc);
    applyPatch(doc, patch({ pages: [{ index: 0, ops: [{ op: "remove", id: "el_title01" }] }] }));
    expect(JSON.stringify(doc)).toBe(copy);
  });

  it("add con posición, remove y reorder", () => {
    const doc = carousel();
    const r = applyPatch(
      doc,
      patch({
        pages: [
          {
            index: 0,
            ops: [
              { op: "add", element: { ...newText, id: "el_nuevo01" }, at: 0 },
              { op: "remove", id: "el_sub0001" },
              { op: "reorder", ids: ["el_title01", "el_nuevo01"] },
            ],
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.pages[0].elements.map((e) => e.id)).toEqual(["el_title01", "el_nuevo01"]);
  });

  it("un id que no existe es un problema y no se aplica nada", () => {
    const r = applyPatch(carousel(), patch({ pages: [{ index: 0, ops: [{ op: "update", id: "el_fantasma", set: { size: 50 } }] }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toMatch(/no existe el elemento el_fantasma/);
  });

  it("una página que no existe es un problema", () => {
    const r = applyPatch(carousel(), patch({ pages: [{ index: 9, ops: [] }] }));
    expect(r.ok).toBe(false);
  });

  it("no deja editar el HTML cargado", () => {
    const doc = carousel();
    doc.pages[0].elements.push({ id: "el_html001", type: "html", x: 50, y: 50, w: 90, h: 90, html: "<p>x</p>" });
    const r = applyPatch(doc, patch({ pages: [{ index: 0, ops: [{ op: "update", id: "el_html001", set: { html: "<script>1</script>" } }] }] }));
    expect(r.ok).toBe(false);
  });

  it("cambia el fondo de una página", () => {
    const r = applyPatch(carousel(), patch({ pages: [{ index: 1, background: { type: "color", color: "#ff0000" }, ops: [] }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.pages[1].background.color).toBe("#ff0000");
  });
});

describe("ai/patch: páginas nuevas y el llamado a la acción", () => {
  it("«Agregá 2 láminas» va ANTES de la última si la última es el llamado a la acción", () => {
    const doc = carousel();
    expect(lastPageIsCta(doc)).toBe(true);
    const r = applyPatch(doc, patch({ pages: [], newPages: [{ page: newPage("Testimonio") }, { page: newPage("Primer paso") }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.pages).toHaveLength(5);
    expect(r.doc.pages[4].id).toBe("pg_cta0001");
    expect(r.doc.pages.slice(2, 4).map((p) => (p.elements[0] as { text: string }).text)).toEqual(["Testimonio", "Primer paso"]);
  });

  it("nunca empuja el cierre aunque la IA diga `after` la última", () => {
    const doc = carousel();
    const r = applyPatch(doc, patch({ pages: [], newPages: [{ after: 2, page: newPage("Extra") }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.pages[r.doc.pages.length - 1].id).toBe("pg_cta0001");
  });

  it("si la última no es un llamado a la acción, agrega al final", () => {
    const doc = carousel();
    doc.pages[2] = page("pg_cta0001", [textEl("el_cta0001", "Más datos del tema", { y: 50 })], { name: "Extra" });
    expect(lastPageIsCta(doc)).toBe(false);
    const r = applyPatch(doc, patch({ pages: [], newPages: [{ page: newPage("Nueva") }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.pages[3].elements[0]).toMatchObject({ text: "Nueva" });
  });

  it("respeta `after` cuando la última no es el cierre y conserva el orden de varias", () => {
    const doc = carousel();
    doc.pages[2] = page("pg_cta0001", [textEl("el_cta0001", "Más datos del tema")]);
    const r = applyPatch(doc, patch({ pages: [], newPages: [{ after: 0, page: newPage("A") }, { after: 0, page: newPage("B") }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.pages.slice(1, 3).map((p) => (p.elements[0] as { text: string }).text)).toEqual(["A", "B"]);
  });

  it("quita páginas, pero no todas", () => {
    expect(applyPatch(carousel(), patch({ pages: [], removePages: [1] }))).toMatchObject({ ok: true });
    expect(applyPatch(carousel(), patch({ pages: [], removePages: [0, 1, 2] })).ok).toBe(false);
  });

  it("no pasa de 20 páginas", () => {
    const many = Array.from({ length: 19 }, (_, i) => ({ page: newPage(`P${i}`) }));
    expect(applyPatch(carousel(), patch({ pages: [], newPages: many.slice(0, 10) })).ok).toBe(true);
    const doc = carousel();
    doc.pages = Array.from({ length: 20 }, (_, i) => page(`pg_full${String(i).padStart(3, "0")}`, [textEl(`el_full${String(i).padStart(3, "0")}`, "x")]));
    expect(applyPatch(doc, patch({ pages: [], newPages: [{ page: newPage("21") }] })).ok).toBe(false);
  });

  it("una página web tiene una sola página", () => {
    const web = { ...singlePage("web") };
    expect(applyPatch(web, patch({ pages: [], newPages: [{ page: newPage("x") }] })).ok).toBe(false);
  });

  it("el documento resultante sigue siendo válido para el esquema", () => {
    const r = applyPatch(carousel(), patch({ pages: [{ index: 0, ops: [{ op: "add", element: { ...newText, id: "el_extra001" } }] }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(parseDesignDoc(r.doc).ok).toBe(true);
  });
});

describe("ai/patch: qué cambió", () => {
  it("describe una página cambiada, páginas agregadas y todas cambiadas", () => {
    const doc = carousel();
    const one = applyPatch(doc, patch({ pages: [{ index: 2, ops: [{ op: "update", id: "el_cta0001", set: { size: 90 } }] }] }));
    if (!one.ok) throw new Error("x");
    expect(changedPageIndexes(doc, one.doc)).toEqual([2]);
    expect(describeChange(doc, one.doc)).toBe("Cambió la página 3");

    const added = applyPatch(doc, patch({ pages: [], newPages: [{ page: newPage("A") }, { page: newPage("B") }] }));
    if (!added.ok) throw new Error("x");
    expect(describeChange(doc, added.doc)).toBe("Agregó 2 páginas");

    const all = applyPatch(
      doc,
      patch({
        pages: [
          { index: 0, ops: [{ op: "update", id: "el_title01", set: { size: 70 } }] },
          { index: 1, ops: [{ op: "update", id: "el_body001", set: { size: 70 } }] },
          { index: 2, ops: [{ op: "update", id: "el_cta0001", set: { size: 70 } }] },
        ],
      }),
    );
    if (!all.ok) throw new Error("x");
    expect(describeChange(doc, all.doc)).toBe("Cambió todas las páginas");
    expect(describeChange(doc, doc)).toBeNull();
  });
});
