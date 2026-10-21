import { describe, expect, it } from "vitest";
import { initialProduct } from "./initial-product";
import type { WizardProduct } from "./catalog";

const variant = (id: string, unavailable: string | null = null) => ({
  id, name: id, billingType: "one_time", billingInterval: null, price: unavailable ? null : 100, detail: "", unavailable,
});
const catalog: WizardProduct[] = [{ id: "p-1", name: "VIP", type: "programa", variants: [variant("v-ok"), variant("v-sin-precio", "Sin precio")] }];

describe("initialProduct (el producto de interés en «Nueva venta»)", () => {
  it("preselecciona el producto y la variante vendibles", () => {
    expect(initialProduct({ catalog }, { productId: "p-1", variantId: "v-ok" })).toEqual({ productId: "p-1", variantId: "v-ok" });
  });
  it("una variante sin precio no se preselecciona; el producto sí", () => {
    expect(initialProduct({ catalog }, { productId: "p-1", variantId: "v-sin-precio" })).toEqual({ productId: "p-1", variantId: "" });
  });
  it("un producto que no se puede vender (o ninguno) arranca vacío", () => {
    expect(initialProduct({ catalog }, { productId: "p-otro" })).toEqual({ productId: "", variantId: "" });
    expect(initialProduct({ catalog })).toEqual({ productId: "", variantId: "" });
  });
});
