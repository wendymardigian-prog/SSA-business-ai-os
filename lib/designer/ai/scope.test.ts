import { describe, expect, it } from "vitest";
import { applyScoped, scopeViolations } from "./scope";
import { parseAiPatch, type DesignPatch } from "./schema";
import { carousel } from "./test-fixtures";

const patch = (json: unknown): DesignPatch => {
  const r = parseAiPatch(json);
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.value;
};

const upd = (index: number, id: string) => ({ index, ops: [{ op: "update", id, set: { size: 80 } }] });
const newText = { type: "text", x: 50, y: 50, w: 80, text: "Nuevo", font: { family: "Inter", weight: 700 }, size: 60, align: "center", color: "#ffffff" };

describe("ai/scope: Solo la página N", () => {
  it("con «Solo la página 2» acepta un parche que toca esa página", () => {
    const r = applyScoped(carousel(), patch({ pages: [upd(1, "el_body001")] }), { page: 1 });
    expect(r.ok).toBe(true);
  });

  it("rechaza las operaciones fuera del alcance, con el motivo", () => {
    const r = applyScoped(carousel(), patch({ pages: [upd(1, "el_body001"), upd(2, "el_cta0001")] }), { page: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toMatch(/página 3, fuera del alcance/);
  });

  it("rechaza un parche de otra página aunque sea una sola operación", () => {
    expect(scopeViolations(patch({ pages: [upd(0, "el_title01")] }), { page: 2 })).toHaveLength(1);
  });

  it("con una sola página no se pueden agregar ni quitar páginas", () => {
    const add = applyScoped(carousel(), patch({ pages: [], newPages: [{ page: { background: { type: "color", color: "#000000" }, elements: [newText] } }] }), { page: 0 });
    expect(add.ok).toBe(false);
    const remove = applyScoped(carousel(), patch({ pages: [], removePages: [1] }), { page: 0 });
    expect(remove.ok).toBe(false);
  });

  it("con alcance «todo» no hay restricciones", () => {
    const r = applyScoped(carousel(), patch({ pages: [upd(0, "el_title01"), upd(2, "el_cta0001")] }), { page: null });
    expect(r.ok).toBe(true);
    expect(scopeViolations(patch({ pages: [], removePages: [1] }), { page: null })).toEqual([]);
  });

  it("un conjunto de páginas (la revisión automática) deja tocar solo esas", () => {
    expect(applyScoped(carousel(), patch({ pages: [upd(0, "el_title01"), upd(2, "el_cta0001")] }), { pages: [0, 2] }).ok).toBe(true);
    expect(applyScoped(carousel(), patch({ pages: [upd(1, "el_body001")] }), { pages: [0, 2] }).ok).toBe(false);
  });

  it("un elemento que es de otra página no se puede tocar con el alcance de esta", () => {
    // el_cta0001 es de la página 3: pedirlo en la página 2 es un problema de elemento inexistente.
    const r = applyScoped(carousel(), patch({ pages: [upd(1, "el_cta0001")] }), { page: 1 });
    expect(r.ok).toBe(false);
  });
});
