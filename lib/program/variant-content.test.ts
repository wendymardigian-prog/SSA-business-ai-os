// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { includedModules, moduleIncluded } from "./variant-content";

describe("lo que incluye la variante", () => {
  const light = [{ section: "program", content: { modules: ["m1", "m2", "m3", "m4"] } }];
  const full = [{ section: "program", content: { modules: "all" as const } }];
  it("una light con 4 de 12 módulos", () => {
    const inc = includedModules([light]);
    expect(moduleIncluded(inc, "m1")).toBe(true);
    expect(moduleIncluded(inc, "m9")).toBe(false);
  });
  it("light + completa ve todo", () => expect(includedModules([light, full])).toBe("all"));
  it("sin la fila Programa no ve nada", () => expect(moduleIncluded(includedModules([[{ section: "community" }]]), "m1")).toBe(false));
});
