// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { addProgramProblem, addableProducts, programCards } from "./programs";

const products = [
  { id: "p1", name: "Mentoría", status: "active", portal_enabled: true, portal_settings: { sections: { community: false } } },
  { id: "p2", name: "Curso", status: "active", portal_enabled: false, portal_settings: null },
  { id: "p3", name: "Viejo", status: "inactive", portal_enabled: false, portal_settings: null },
];
const variants = [
  { id: "v1", product_id: "p1", name: "12 semanas", portal_settings: { enabled: true } },
  { id: "v2", product_id: "p1", name: "6 semanas", portal_settings: {} },
  { id: "v3", product_id: "p2", name: "Único", portal_settings: null },
  { id: "v4", product_id: "p3", name: "Único", portal_settings: null },
];

describe("Portal › Programas", () => {
  it("una tarjeta por producto con portal, con sus variantes y secciones", () => {
    const [c] = programCards(products, variants);
    expect(c).toMatchObject({ id: "p1", variantsWithAccess: 1, variantsTotal: 2 });
    expect(c.sectionsOn).not.toContain("Comunidad");
    expect(c.sectionsOn).toContain("Programa");
  });
  it("se agregan productos activos sin portal", () => {
    expect(addableProducts(products, variants).map((p) => p.id)).toEqual(["p2"]);
  });
  it("sin variantes elegidas se rechaza", () => {
    expect(addProgramProblem("p2", [])).toBe("Elegí al menos una variante con acceso al portal");
    expect(addProgramProblem(null, ["v3"])).toBe("Elegí el producto");
    expect(addProgramProblem("p2", ["v3"])).toBeNull();
  });
});
