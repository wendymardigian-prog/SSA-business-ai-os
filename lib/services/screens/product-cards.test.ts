// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { parseVariantTab, productCardView, variantRowView, variantTabs, type VariantFacts } from "./product-cards";

const v = (over: Partial<VariantFacts>): VariantFacts => ({
  id: "v1", name: "12 semanas", archived: false, price: 1000, serviceSettings: {}, journeyTemplate: null, portalSettings: {}, activeServices: 0, ...over,
});
const tpl = { v: 1 as const, phases: [{ key: "ph_aaaaa1", name: "A", duration_days: 30, items: [{ key: "it_aaaaa1", kind: "checkbox" as const, name: "x" }] }] };

describe("la tarjeta del producto", () => {
  it("portal: todas, algunas o ninguna variante", () => {
    const on = { enabled: true, sections: [{ key: "program" }] };
    const base = { id: "p", name: "Programa", typeLabel: "Programa", statusLabel: "Activo" };
    expect(productCardView({ ...base, variants: [v({ portalSettings: on })] }).portalLabel).toBe("Portal");
    expect(productCardView({ ...base, variants: [v({ portalSettings: on }), v({ id: "v2" }), v({ id: "v3" })] }).portalLabel).toBe("Portal · 1 de 3 variantes");
    expect(productCardView({ ...base, variants: [v({})] }).portalLabel).toBe("Sin portal");
  });

  it("rango de precios de las variantes activas, servicios activos y variantes con camino", () => {
    const card = productCardView({
      id: "p", name: "P", typeLabel: "Programa", statusLabel: "Activo",
      variants: [
        v({ price: 300, activeServices: 2, serviceSettings: { v: 1, mode: "create" }, journeyTemplate: tpl }),
        v({ id: "v2", price: 1000, activeServices: 1 }),
        v({ id: "v3", price: 5000, archived: true, activeServices: 9 }),
      ],
    });
    expect(card.priceLabel).toBe("USD 300,00 – USD 1.000,00");
    expect(card.activeServices).toBe(3);
    expect(card.journeyLabel).toBe("1 variante con camino");
    expect(card.variantsLabel).toBe("2 variantes");
  });
});

describe("la fila de la variante", () => {
  it("crea con camino, crea sin camino (en naranja), extiende y no crea", () => {
    expect(variantRowView("p", v({ serviceSettings: { v: 1, mode: "create" }, journeyTemplate: tpl }))).toMatchObject({ modeLabel: "Crea un servicio", journeyLabel: "1 fase · 1 paso · 30 días", journeyMissing: false });
    expect(variantRowView("p", v({ serviceSettings: { v: 1, mode: "create" } }))).toMatchObject({ journeyLabel: "Sin camino", journeyMissing: true });
    expect(variantRowView("p", v({ serviceSettings: { v: 1, mode: "extend" } })).journeyLabel).toBe("Usa el del servicio que extiende");
    expect(variantRowView("p", v({})).modeLabel).toBe("No crea servicio");
    expect(variantRowView("p", v({})).href).toBe("/dashboard/settings/productos/p/variantes/v1");
  });

  it("el portal: N secciones o Sin acceso", () => {
    expect(variantRowView("p", v({ portalSettings: { enabled: true, sections: [{}, {}] } })).portalLabel).toBe("2 secciones");
    expect(variantRowView("p", v({ portalSettings: { enabled: false, sections: [{}] } })).portalLabel).toBe("Sin acceso");
  });
});

describe("las pestañas de la variante", () => {
  it("con el modulo apagado, solo Precio y cobro", () => {
    expect(variantTabs({ moduleOn: false, can: () => true })).toEqual(["precio"]);
  });
  it("cada pestaña con su permiso", () => {
    expect(variantTabs({ moduleOn: true, can: () => true })).toEqual(["camino", "servicio", "portal", "precio"]);
    expect(variantTabs({ moduleOn: true, can: (k) => k === "portal.access_rules" })).toEqual(["portal", "precio"]);
    expect(variantTabs({ moduleOn: true, can: () => false })).toEqual(["precio"]);
  });
  it("una pestaña que no se puede ver cae en la primera", () => {
    expect(parseVariantTab("camino", ["portal", "precio"])).toBe("portal");
    expect(parseVariantTab("precio", ["camino", "precio"])).toBe("precio");
    expect(parseVariantTab(null, ["camino", "precio"])).toBe("camino");
  });
});
