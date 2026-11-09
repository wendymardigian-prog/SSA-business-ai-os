"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { HeaderTabs } from "@/components/ui/header-tabs";
import { activeFinanceTab } from "@/lib/finance/tabs";

/**
 * Las pestañas de Finanzas (Resumen · Gastos · Recurrentes · Proveedores). El layout decide cuáles ve cada persona
 * (`visibleFinanceTabs`) y las pasa por contexto; cada pantalla las pone en la barra superior con
 * `<PageHeader tabs={<FinanceTabs />} />`. Son links, no botones: cambian de pantalla, y la activa se anuncia con
 * `aria-current="page"`. En el celular la barra baja a su fila y se desplaza ADENTRO (la página no hace scroll
 * horizontal). Usa `HeaderTabs`, las pestañas de la barra de todas las pantallas.
 */
export interface FinanceTabItem {
  id: string;
  name: string;
  href: string;
}

const TabsContext = createContext<readonly FinanceTabItem[]>([]);

export function FinanceTabsProvider({ tabs, children }: { tabs: readonly FinanceTabItem[]; children: ReactNode }) {
  return <TabsContext.Provider value={tabs}>{children}</TabsContext.Provider>;
}

export function FinanceTabs() {
  const tabs = useContext(TabsContext);
  const pathname = usePathname() ?? "";
  const active = activeFinanceTab(pathname) ?? "";
  return <HeaderTabs label="Secciones de Finanzas" active={active} items={tabs.map((t) => ({ key: t.id, label: t.name, href: t.href }))} />;
}

/** La línea de arriba de quien tiene `expenses.view` sin `expenses.manage`. */
export function ReadOnlyNote() {
  return (
    <p role="status" className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      Tenés acceso de lectura: podés ver todo, pero no cambiar nada.
    </p>
  );
}
