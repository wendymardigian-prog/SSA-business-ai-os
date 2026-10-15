"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { activeFinanceTab } from "@/lib/finance/tabs";

/**
 * Las pestañas de Finanzas (Resumen · Gastos · Recurrentes · Proveedores). El layout decide cuáles ve cada persona
 * (`visibleFinanceTabs`) y las pasa por contexto; cada pantalla las pone en la barra superior con
 * `<PageHeader tabs={<FinanceTabs />} />`. Son links, no botones: cambian de pantalla, y la activa se anuncia con
 * `aria-current="page"`. En el celular la barra baja a su fila y se desplaza ADENTRO (la página no hace scroll
 * horizontal). Mismo look que `components/comunicacion/section-tabs.tsx`.
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
  const active = activeFinanceTab(pathname);
  if (tabs.length === 0) return null;
  return (
    <nav aria-label="Secciones de Finanzas" className="flex shrink-0 items-center rounded-lg border border-border p-0.5">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-sm transition-colors",
              isActive ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {tab.name}
          </Link>
        );
      })}
    </nav>
  );
}

/** La línea de arriba de quien tiene `expenses.view` sin `expenses.manage`. */
export function ReadOnlyNote() {
  return (
    <p role="status" className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      Tenés acceso de lectura: podés ver todo, pero no cambiar nada.
    </p>
  );
}
