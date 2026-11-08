// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { backToPathHref } from "./back-to-path";

const P = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";

describe("Volver al camino", () => {
  it("acepta la variante con su pestaña", () => {
    expect(backToPathHref(`/dashboard/settings/productos/${P}/variantes/${V}?tab=camino`)).toBe(`/dashboard/settings/productos/${P}/variantes/${V}?tab=camino`);
  });
  it("rechaza cualquier otra direccion", () => {
    for (const bad of ["https://otro.test/x", "//otro.test", "/dashboard/contacts", `/dashboard/settings/productos/${P}`, "javascript:alert(1)", null, undefined]) {
      expect(backToPathHref(bad as string)).toBeNull();
    }
  });
});
