import { describe, expect, it } from "vitest";
import { FINANCE_ENTRY_PERMISSIONS, activeFinanceTab, financeEntryHref, visibleFinanceTabs } from "./tabs";

const can = (...keys: string[]) => (k: string) => keys.includes(k);

describe("tabs de Finanzas", () => {
  it("con expenses.view ve Resumen, Gastos, Recurrentes y Proveedores (la configuración está en Ajustes)", () => {
    expect(visibleFinanceTabs(can("expenses.view")).map((t) => t.name)).toEqual(["Resumen", "Gastos", "Recurrentes", "Proveedores"]);
  });
  it("sin la clave no ve ninguna", () => {
    expect(visibleFinanceTabs(can())).toEqual([]);
    expect(financeEntryHref(can())).toBeNull();
  });
  // Cambio aprobado M9 (Extra I): quien solo tiene commissions.view entra a Finanzas pero NO ve las pestañas de gastos.
  it("commissions.view deja entrar a Finanzas pero no muestra ninguna pestaña de gastos", () => {
    expect(FINANCE_ENTRY_PERMISSIONS).toEqual(["expenses.view", "commissions.view"]);
    expect(visibleFinanceTabs(can("commissions.view"))).toEqual([]);
    // Todavia no existe la pestaña de Comisiones: no hay a donde mandarlo (quien llama redirige a /dashboard).
    expect(financeEntryHref(can("commissions.view"))).toBeNull();
  });
  it("la pestaña activa sale de la ruta", () => {
    expect(activeFinanceTab("/dashboard/finanzas")).toBe("resumen");
    expect(activeFinanceTab("/dashboard/finanzas/gastos/abc")).toBe("gastos");
    expect(activeFinanceTab("/dashboard/finanzas/recurrentes")).toBe("recurrentes");
    expect(activeFinanceTab("/dashboard/finanzas/proveedores?x=1")).toBe("proveedores");
  });
});
