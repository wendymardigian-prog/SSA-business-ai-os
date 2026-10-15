import { describe, expect, it } from "vitest";
import { FINANCE_ENTRY_PERMISSIONS, OWN_COMMISSIONS_TAB_NAME, activeFinanceTab, financeEntryHref, visibleFinanceTabs } from "./tabs";

const can = (...keys: string[]) => (k: string) => keys.includes(k);

describe("tabs de Finanzas", () => {
  it("con expenses.view ve Resumen, Gastos, Recurrentes y Proveedores (la configuración está en Ajustes)", () => {
    expect(visibleFinanceTabs(can("expenses.view")).map((t) => t.name)).toEqual(["Resumen", "Gastos", "Recurrentes", "Proveedores"]);
  });
  it("sin la clave no ve ninguna", () => {
    expect(visibleFinanceTabs(can())).toEqual([]);
    expect(financeEntryHref(can())).toBeNull();
  });
  // Cambio aprobado M9 (Extra I): quien solo tiene commissions.view entra a Finanzas pero NO ve las pestañas de gastos:
  // ve solo la de Comisiones, y es a donde cae al abrir Finanzas.
  it("commissions.view deja entrar a Finanzas y muestra solo la pestaña de Comisiones, no las de gastos", () => {
    expect(FINANCE_ENTRY_PERMISSIONS).toEqual(["expenses.view", "commissions.view"]);
    expect(visibleFinanceTabs(can("commissions.view")).map((t) => t.id)).toEqual(["comisiones"]);
    expect(financeEntryHref(can("commissions.view"))).toBe("/dashboard/finanzas/comisiones");
  });
  it("quien ve gastos y comisiones tiene cinco pestañas, con Comisiones al final", () => {
    expect(visibleFinanceTabs(can("expenses.view", "commissions.view")).map((t) => t.name)).toEqual(["Resumen", "Gastos", "Recurrentes", "Proveedores", "Comisiones"]);
    // El Resumen sigue siendo la entrada de quien ve gastos.
    expect(financeEntryHref(can("expenses.view", "commissions.view"))).toBe("/dashboard/finanzas");
  });
  it("con alcance propio la pestaña se llama «Mis comisiones» y con alcance total, «Comisiones»", () => {
    expect(visibleFinanceTabs(can("commissions.view"), { commissionsScope: "own" }).map((t) => t.name)).toEqual([OWN_COMMISSIONS_TAB_NAME]);
    expect(OWN_COMMISSIONS_TAB_NAME).toBe("Mis comisiones");
    expect(visibleFinanceTabs(can("commissions.view"), { commissionsScope: "all" }).map((t) => t.name)).toEqual(["Comisiones"]);
    // El alcance no toca las demás pestañas ni su href.
    const own = visibleFinanceTabs(can("expenses.view", "commissions.view"), { commissionsScope: "own" });
    expect(own.map((t) => t.name)).toEqual(["Resumen", "Gastos", "Recurrentes", "Proveedores", "Mis comisiones"]);
    expect(own.at(-1)?.href).toBe("/dashboard/finanzas/comisiones");
  });
  it("la pestaña activa sale de la ruta", () => {
    expect(activeFinanceTab("/dashboard/finanzas")).toBe("resumen");
    expect(activeFinanceTab("/dashboard/finanzas/gastos/abc")).toBe("gastos");
    expect(activeFinanceTab("/dashboard/finanzas/recurrentes")).toBe("recurrentes");
    expect(activeFinanceTab("/dashboard/finanzas/proveedores?x=1")).toBe("proveedores");
    expect(activeFinanceTab("/dashboard/finanzas/comisiones")).toBe("comisiones");
    expect(activeFinanceTab("/dashboard/finanzas/comisiones/reglas")).toBe("comisiones");
  });
});
