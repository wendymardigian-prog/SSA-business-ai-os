import { describe, it, expect } from "vitest";
import {
  newPathId,
  isGeneratedPathId,
  isReservedPathId,
  validateBranchData,
  pathsOf,
  MAX_PATHS,
  RESERVED_PATH_IDS,
  BRANCH_ELSE_HANDLE,
} from "./branch-paths";
import type { BranchPath } from "./condition-eval";

const path = (id: string, over: Partial<BranchPath> = {}): BranchPath => ({
  id,
  label: `Camino ${id}`,
  logic: "and",
  conditions: [{ field: "answer.x", operator: "is", value: "a", valueType: "single_select" }],
  ...over,
});

describe("ids de camino", () => {
  it("tienen la forma p_xxxxxx y no son ninguno de los reservados", () => {
    for (let i = 0; i < 200; i++) {
      const id = newPathId();
      expect(isGeneratedPathId(id)).toBe(true);
      expect(isReservedPathId(id)).toBe(false);
    }
  });
  it("no repiten los que ya hay, aunque el azar insista", () => {
    const constant = () => 0; // siempre "aaaaaa"
    expect(newPathId(["p_aaaaaa"], constant)).not.toBe("p_aaaaaa");
  });
  it("el azar entra por parametro: mismo azar, mismo id", () => {
    const seq = () => 0.5;
    expect(newPathId([], seq)).toBe(newPathId([], seq));
  });
  it("else, true, false, yes y no estan reservados (el motor los toma por otra cosa)", () => {
    expect([...RESERVED_PATH_IDS].sort()).toEqual(["else", "false", "no", "true", "yes"]);
    expect(BRANCH_ELSE_HANDLE).toBe("else");
    for (const id of RESERVED_PATH_IDS) expect(isReservedPathId(id)).toBe(true);
    expect(isGeneratedPathId("else")).toBe(false);
    expect(isGeneratedPathId("p_abc")).toBe(false);
  });
});

describe("validateBranchData", () => {
  it("un nodo bien armado no tiene errores", () => {
    expect(validateBranchData({ paths: [path("p_aaaaaa"), path("p_bbbbbb")] })).toEqual([]);
  });
  it("de 1 a 10 caminos", () => {
    expect(validateBranchData({ paths: [] })).toContain("Tiene que haber al menos un camino.");
    expect(validateBranchData(undefined)).toContain("Tiene que haber al menos un camino.");
    const many = Array.from({ length: MAX_PATHS + 1 }, (_, i) => path(`p_${String(i).padStart(6, "0")}`));
    expect(validateBranchData({ paths: many }).join(" ")).toContain("Como máximo 10");
    expect(validateBranchData({ paths: many.slice(0, MAX_PATHS) })).toEqual([]);
  });
  it("rechaza ids reservados, repetidos o vacios", () => {
    expect(validateBranchData({ paths: [path("else")] }).join(" ")).toContain("reservado");
    expect(validateBranchData({ paths: [path("true")] }).join(" ")).toContain("reservado");
    expect(validateBranchData({ paths: [path("p_aaaaaa"), path("p_aaaaaa")] }).join(" ")).toContain("mismo identificador");
    expect(validateBranchData({ paths: [path("")] }).join(" ")).toContain("no tiene identificador");
  });
  it("cada camino necesita nombre, logica y al menos una condicion", () => {
    const errors = validateBranchData({ paths: [path("p_aaaaaa", { label: "  ", conditions: [], logic: "x" as never })] });
    expect(errors.join(" ")).toContain("necesita un nombre");
    expect(errors.join(" ")).toContain('"y" o con "o"');
    expect(errors.join(" ")).toContain("al menos una condición");
  });
  it("un nombre demasiado largo se rechaza", () => {
    expect(validateBranchData({ paths: [path("p_aaaaaa", { label: "x".repeat(61) })] }).join(" ")).toContain("muy largo");
  });
  it("pathsOf no se rompe con datos a medias", () => {
    expect(pathsOf(undefined)).toEqual([]);
    expect(pathsOf({ paths: null as never })).toEqual([]);
    expect(pathsOf({ paths: [null, path("p_aaaaaa")] as never })).toHaveLength(1);
  });
});
