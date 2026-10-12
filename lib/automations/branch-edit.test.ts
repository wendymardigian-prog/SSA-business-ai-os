import { describe, it, expect } from "vitest";
import { MAX_PATHS } from "@/lib/flow-engine/branch-paths";
import { pruneBranchEdges, addPath, blankBranchPath, canAddPath, canRemovePath, fillPathLabels, movePath, nextPathLabel, pathDisplayLabel, patchPath, removePath, renamePath } from "./branch-edit";

const p = (id: string, label = ""): { id: string; label: string } => ({ id, label });
// Un generador que siempre empieza igual: lo que se prueba es que no repita, no el azar.
const fixed = () => 0;

describe("nombres de los caminos", () => {
  it("un nombre vacio se ve como 'Camino N' (N = posicion)", () => {
    expect(pathDisplayLabel(p("a", ""), 0)).toBe("Camino 1");
    expect(pathDisplayLabel(p("a", "   "), 2)).toBe("Camino 3");
    expect(pathDisplayLabel(p("a", "Calificados"), 2)).toBe("Calificados");
  });

  it("el nombre nuevo no choca con los que ya hay", () => {
    expect(nextPathLabel([])).toBe("Camino 1");
    expect(nextPathLabel([p("a", "Camino 2")])).toBe("Camino 3");
    expect(nextPathLabel([p("a", "Camino 3"), p("b", "Otro")])).toBe("Camino 4");
  });

  it("fillPathLabels completa solo los vacios", () => {
    expect(fillPathLabels([p("a", ""), p("b", "Mi camino"), p("c", " ")]).map((x) => x.label)).toEqual(["Camino 1", "Mi camino", "Camino 3"]);
  });
});

describe("agregar y borrar", () => {
  it("agrega al final con un id nuevo y un nombre que no choca", () => {
    const out = addPath([p("p_aaaaaa", "Camino 1")], (id, label) => blankBranchPath(id, label), fixed);
    expect(out).toHaveLength(2);
    expect(out[1].label).toBe("Camino 2");
    expect(out[1].id).toMatch(/^p_[a-z0-9]{6}$/);
    expect(out[1].id).not.toBe("p_aaaaaa");
  });

  it("quien llama puede elegir el id del camino nuevo (si no choca ni es reservado)", () => {
    const base = [p("p_aaaaaa", "Camino 1")];
    expect(addPath(base, (id, label) => ({ id, label }), fixed, "p_nuevo1")[1].id).toBe("p_nuevo1");
    expect(addPath(base, (id, label) => ({ id, label }), fixed, "p_aaaaaa")[1].id).not.toBe("p_aaaaaa");
    expect(addPath(base, (id, label) => ({ id, label }), fixed, "else")[1].id).not.toBe("else");
  });

  it("con el maximo no agrega", () => {
    const full = Array.from({ length: MAX_PATHS }, (_, i) => p(`p_00000${i % 10}`.slice(0, 8)));
    expect(canAddPath(full.length)).toBe(false);
    expect(addPath(full, (id, label) => ({ id, label }))).toBe(full);
  });

  it("el ultimo camino no se borra (1 a 10)", () => {
    expect(canRemovePath(1)).toBe(false);
    expect(removePath([p("a")], "a")).toEqual([p("a")]);
    expect(removePath([p("a"), p("b")], "a")).toEqual([p("b")]);
  });
});

describe("renombrar, mover y cambiar", () => {
  it("renombrar no cambia el id", () => {
    expect(renamePath([p("a", "x"), p("b", "y")], "b", "Nuevo")).toEqual([p("a", "x"), p("b", "Nuevo")]);
  });

  it("un nombre muy largo se corta", () => {
    expect(renamePath([p("a")], "a", "x".repeat(200))[0].label).toHaveLength(60);
  });

  it("mover cambia el orden y deja los ids", () => {
    const list = [p("a"), p("b"), p("c")];
    expect(movePath(list, "b", -1).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(movePath(list, "b", 1).map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  it("mover en el borde no hace nada", () => {
    const list = [p("a"), p("b")];
    expect(movePath(list, "a", -1)).toBe(list);
    expect(movePath(list, "b", 1)).toBe(list);
    expect(movePath(list, "zzz", 1)).toBe(list);
  });

  it("patchPath nunca cambia el id", () => {
    const out = patchPath<{ id: string; label: string; logic: "and" | "or" }>([{ id: "a", label: "x", logic: "and" }], "a", { logic: "or", id: "otro" });
    expect(out[0]).toEqual({ id: "a", label: "x", logic: "or" });
  });
});

describe("pruneBranchEdges", () => {
  const edges = [
    { source: "n", target: "a", sourceHandle: "p_aaaaaa" },
    { source: "n", target: "b", sourceHandle: "p_bbbbbb" },
    { source: "n", target: "c", sourceHandle: "else" },
    { source: "n", target: "d" },
    { source: "otro", target: "e", sourceHandle: "p_bbbbbb" },
  ];

  it("suelta solo las conexiones de ESTE nodo que salian de un camino borrado", () => {
    const out = pruneBranchEdges("n", [{ id: "p_aaaaaa" }], edges);
    expect(out.map((e) => e.target)).toEqual(["a", "c", "d", "e"]);
  });

  it("'Si no' nunca se suelta", () => {
    expect(pruneBranchEdges("n", [], edges).some((e) => e.sourceHandle === "else")).toBe(true);
  });
});
