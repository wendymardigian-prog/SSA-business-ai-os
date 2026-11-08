// @plantilla-quitar(ventas)
import { describe, expect, it } from "vitest";
import cases from "./product-links.cases.json";
import { normalizePrimaries, validateProductLinks, type ProductLinks } from "./product-links";

describe("validateProductLinks (casos compartidos con la base)", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(validateProductLinks(c.links, c.variants)).toEqual(c.expected);
    });
  }
});

describe("los principales", () => {
  it("desactivar o vencer un principal lo deja vacio con el aviso", () => {
    const links: ProductLinks = {
      v: 1,
      primary_learn: "lk_aaaaa1",
      primary_convert: "lk_aaaaa2",
      items: [
        { key: "lk_aaaaa1", name: "L", kind: "landing", url: "https://a.test", active: false, valid_until: null, variant_id: null },
        { key: "lk_aaaaa2", name: "A", kind: "booking", url: "https://a.test", active: true, valid_until: "2026-01-01", variant_id: null },
      ],
    };
    const r = normalizePrimaries(links, "2026-11-08");
    expect(r.links.primary_learn).toBeNull();
    expect(r.links.primary_convert).toBeNull();
    expect(r.notices).toEqual(["Elegí otro link principal para conocer.", "Elegí otro link principal para convertir."]);
  });
});
