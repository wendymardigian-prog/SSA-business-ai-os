"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { tabCountLabel } from "@/lib/ui/topbar-tabs";

/**
 * Las pestañas de una pantalla, en la barra superior (`<PageHeader tabs={<TopbarTabs … />} />`).
 *
 * Mismo aspecto que `FinanceTabs` y las pestañas de Comunicación: un control segmentado. Son links (cambian la URL)
 * y la activa se anuncia con `aria-current="page"`. Una pestaña puede llevar un contador (`count`): un círculo con el
 * número, que no se dibuja con 0. En el celular la barra baja a su propia fila y se desplaza adentro (lo resuelve
 * `PageHeader`). Si una pantalla cambia de pestaña sin ir al servidor, pasa `onSelect` y el link no navega.
 */
export interface TopbarTab {
  key: string;
  label: string;
  href: string;
  count?: number | null;
  /** Qué dice el lector de pantalla del contador («3 por revisar»). Sin esto, el número solo. */
  countLabel?: string;
}

export function TopbarTabs({
  tabs,
  active,
  label,
  onSelect,
}: {
  tabs: readonly TopbarTab[];
  active: string;
  /** Nombre accesible del grupo («Secciones del Portal»). */
  label: string;
  onSelect?: (key: string) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <nav aria-label={label} className="flex shrink-0 items-center rounded-lg border border-border p-0.5">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        const count = tabCountLabel(tab.count);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            scroll={false}
            onClick={(e) => {
              if (!onSelect || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onSelect(tab.key);
            }}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors",
              isActive ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {tab.label}
            {count && (
              <span
                className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
                aria-label={tab.countLabel ? `${tab.count} ${tab.countLabel}` : undefined}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
