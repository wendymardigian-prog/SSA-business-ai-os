/**
 * Las pestañas de Finanzas y quién ve cada una (pura). El menú muestra "Finanzas" a quien tenga cualquiera de
 * las claves; adentro, cada pestaña pide la suya. Sin pestaña de configuración: va en Ajustes > General.
 */
export interface FinanceTab {
  id: "resumen" | "gastos" | "recurrentes" | "proveedores" | "comisiones";
  name: string;
  href: string;
  /** Alguna de estas claves alcanza. */
  permissions: readonly string[];
}

export const FINANCE_TABS: readonly FinanceTab[] = [
  { id: "resumen", name: "Resumen", href: "/dashboard/finanzas", permissions: ["expenses.view"] },
  { id: "gastos", name: "Gastos", href: "/dashboard/finanzas/gastos", permissions: ["expenses.view"] },
  { id: "recurrentes", name: "Recurrentes", href: "/dashboard/finanzas/recurrentes", permissions: ["expenses.view"] },
  { id: "proveedores", name: "Proveedores", href: "/dashboard/finanzas/proveedores", permissions: ["expenses.view"] },
];

/** Las claves con las que alguien entra a Finanzas (el layout y el menú piden alguna). */
export const FINANCE_ENTRY_PERMISSIONS: readonly string[] = ["expenses.view"];

export function visibleFinanceTabs(can: (key: string) => boolean): FinanceTab[] {
  return FINANCE_TABS.filter((t) => t.permissions.some((k) => can(k)));
}

/** La pestaña activa según la ruta (la más específica que coincide). */
export function activeFinanceTab(pathname: string): FinanceTab["id"] {
  const path = pathname.split("?")[0].replace(/\/+$/, "");
  const match = [...FINANCE_TABS].filter((t) => t.id !== "resumen" && (path === t.href || path.startsWith(`${t.href}/`)));
  return match.sort((a, b) => b.href.length - a.href.length)[0]?.id ?? "resumen";
}

/** A dónde manda `/dashboard/finanzas` a quien no ve el Resumen. */
export function financeEntryHref(can: (key: string) => boolean): string | null {
  return visibleFinanceTabs(can)[0]?.href ?? null;
}
