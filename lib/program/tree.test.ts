// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { buildTree, flattenTree, inactiveDescendants, moduleProgress, reorderTree, type ProgramRow } from "./tree";

const rows: ProgramRow[] = [
  { id: "m2", parent_id: null, kind: "module", lesson_type: null, title: "Dos", position: 1, status: "active" },
  { id: "m1", parent_id: null, kind: "module", lesson_type: null, title: "Uno", position: 0, status: "inactive" },
  { id: "l1", parent_id: "m1", kind: "lesson", lesson_type: "video", title: "Clase", position: 0, status: "active" },
  { id: "s1", parent_id: "m2", kind: "submodule", lesson_type: null, title: "Sub", position: 0, status: "active" },
  { id: "l2", parent_id: "s1", kind: "lesson", lesson_type: "html", title: "Clase 2", position: 0, status: "inactive" },
  { id: "l3", parent_id: "m2", kind: "lesson", lesson_type: "video", title: "Vieja", position: 1, status: "archived" },
];

describe("el árbol del programa", () => {
  it("arma el orden y hereda lo inactivo", () => {
    const flat = flattenTree(buildTree(rows));
    expect(flat.map((n) => n.id)).toEqual(["m1", "l1", "m2", "s1", "l2"]);
    expect(flat.find((n) => n.id === "l1")?.hiddenByParent).toBe(true);
    expect(flat.find((n) => n.id === "s1")?.hiddenByParent).toBe(false);
    expect(flat.find((n) => n.id === "l2")?.depth).toBe(2);
  });
  it("lo archivado no se dibuja salvo que se pida", () => {
    expect(flattenTree(buildTree(rows, { includeArchived: true })).some((n) => n.id === "l3")).toBe(true);
  });
  it("reordena con posiciones consecutivas", () => {
    expect(reorderTree([{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }], { id: "c", to: 0 })).toEqual(["c", "a", "b"]);
    expect(reorderTree([{ id: "a", position: 0 }, { id: "b", position: 1 }], { id: "a", to: 9 })).toEqual(["b", "a"]);
  });
  it("cuenta las clases inactivas debajo", () => {
    const m2 = buildTree(rows).find((n) => n.id === "m2")!;
    expect(inactiveDescendants(m2)).toBe(1);
  });
  it("el avance solo cuenta lo activo: 10 obligatorias con 2 inactivas, completar 8 es 100 %", () => {
    const lessons = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, status: (i < 2 ? "inactive" : "active") as "inactive" | "active" }));
    expect(moduleProgress(lessons, new Set(lessons.slice(2).map((l) => l.id)))).toEqual({ done: 8, total: 8, pct: 100 });
  });
});
