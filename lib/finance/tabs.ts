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
  // Se llega con `commissions.view`: quien solo tiene esa clave (el Member de sistema, cambio aprobado M9) ve SOLO esta pestaña.
  { id: "comisiones", name: "Comisiones", href: "/dashboard/finanzas/comisiones", permissions: ["commissions.view"] },
];

/** Cómo se llama la pestaña de comisiones para quien ve solo las suyas. */
export const OWN_COMMISSIONS_TAB_NAME = "Mis comisiones";

/**
 * Las claves con las que alguien entra a Finanzas (el layout y el menú piden ALGUNA). `commissions.view` (cambio
 * aprobado M9) deja entrar al Member de sistema a ver sus comisiones; las pestañas de gastos siguen pidiendo
 * `expenses.view`.
 */
export const FINANCE_ENTRY_PERMISSIONS: readonly string[] = ["expenses.view", "commissions.view"];

export interface VisibleTabsOptions {
  /** El alcance de `commissions.view`. Con `own`, la pestaña se llama «Mis comisiones» (es la lista de lo suyo). */
  commissionsScope?: "own" | "all";
}

export function visibleFinanceTabs(can: (key: string) => boolean, options: VisibleTabsOptions = {}): FinanceTab[] {
  return FINANCE_TABS.filter((t) => t.permissions.some((k) => can(k))).map((t) =>
    t.id === "comisiones" && options.commissionsScope === "own" ? { ...t, name: OWN_COMMISSIONS_TAB_NAME } : t,
  );
}

/** La pestaña activa según la ruta (la más específica que coincide). */
export function activeFinanceTab(pathname: string): FinanceTab["id"] {
  const path = pathname.split("?")[0].replace(/\/+$/, "");
  const match = [...FINANCE_TABS].filter((t) => t.id !== "resumen" && (path === t.href || path.startsWith(`${t.href}/`)));
  return match.sort((a, b) => b.href.length - a.href.length)[0]?.id ?? "resumen";
}

/**
 * A dónde manda `/dashboard/finanzas` a quien no ve el Resumen: la primera pestaña que ve (quien solo tiene
 * `commissions.view` cae en Comisiones), o `null` si ninguna: quien llama redirige a `/dashboard`.
 */
export function financeEntryHref(can: (key: string) => boolean): string | null {
  return visibleFinanceTabs(can)[0]?.href ?? null;
}
