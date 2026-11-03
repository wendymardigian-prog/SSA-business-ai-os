import { describe, expect, it } from "vitest";
import { filterOptions, multiFilterSummary } from "./multi-filter";

describe("el filtro de varias opciones", () => {
  const labels: Record<string, string> = { a: "Ana", b: "Bruno", c: "Carla" };
  const labelOf = (v: string) => labels[v] ?? v;

  it("cerrado dice qué hay elegido", () => {
    expect(multiFilterSummary([], labelOf)).toBe("Todos");
    expect(multiFilterSummary(["a"], labelOf)).toBe("Ana");
    expect(multiFilterSummary(["a", "b"], labelOf)).toBe("Ana, Bruno");
    expect(multiFilterSummary(["a", "b", "c"], labelOf)).toBe("3 elegidos");
  });

  it("el buscador ignora acentos y mayúsculas", () => {
    const options = [{ value: "1", label: "Mentoría grupal" }, { value: "2", label: "Curso" }];
    expect(filterOptions(options, "MENTORIA")).toEqual([options[0]]);
    expect(filterOptions(options, "  ")).toEqual(options);
    expect(filterOptions(options, "zzz")).toEqual([]);
  });
});
