// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { copyPlan, copiedPath, filePaths } from "./copy";

const items = [
  { id: "m1", parent_id: null, kind: "module" as const, position: 0 },
  { id: "l2", parent_id: "m1", kind: "lesson" as const, position: 1 },
  { id: "s1", parent_id: "m1", kind: "submodule" as const, position: 0 },
  { id: "l1", parent_id: "s1", kind: "lesson" as const, position: 0 },
  { id: "m2", parent_id: null, kind: "module" as const, position: 1 },
];

describe("copiar a otro programa", () => {
  it("un módulo con sus submódulos y clases, padres primero y en su orden", () => expect(copyPlan(items, "m1").map((i) => i.id)).toEqual(["m1", "s1", "l1", "l2"]));
  it("una clase, sola", () => expect(copyPlan(items, "l2").map((i) => i.id)).toEqual(["l2"]));
  it("algo que no está", () => expect(copyPlan(items, "zz")).toEqual([]));
  it("los archivos de un ítem, incluidos los recursos", () =>
    expect(filePaths({ document_path: "a/b/doc.pdf", cover_path: null, resources: [{ path: "a/b/r.zip" }, { url: "https://x" }] })).toEqual(["a/b/doc.pdf", "a/b/r.zip"]));
  it("la ruta nueva va en la carpeta del ítem nuevo", () => expect(copiedPath("ws/p1/i1/document-1-doc.pdf", "ws", "p2", "i9")).toBe("ws/p2/i9/document-1-doc.pdf"));
});
