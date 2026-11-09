import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Las pestañas de la barra superior, iguales en todas las pantallas: un control segmentado (fondo gris, la activa en
 * blanco) con links. Van en `<PageHeader tabs={…} />` (o en `left` cuando son dos vistas hermanas, como Ventas ⇄
 * Pagos). Son links y no botones: cada pestaña tiene su URL, y la activa se anuncia con `aria-current="page"`. En el
 * celular `PageHeader` las baja a su fila, que se desplaza de costado (la página no hace scroll horizontal).
 */
export interface HeaderTabItem {
  key: string;
  label: string;
  href: string;
  icon?: ComponentType<{ className?: string }>;
  /** Un número chico al lado del nombre (cuántos hay en esa pestaña). */
  count?: ReactNode;
}

export const headerTabClass = (active: boolean) =>
  cn(
    "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors",
    active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
  );

export function HeaderTabs({ items, active, label }: { items: readonly HeaderTabItem[]; active: string; label: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className="flex shrink-0 items-center rounded-lg bg-muted/60 p-0.5">
      {items.map((tab) => {
        const on = tab.key === active;
        const Icon = tab.icon;
        return (
          <Link key={tab.key} href={tab.href} aria-current={on ? "page" : undefined} className={headerTabClass(on)}>
            {Icon && <Icon className="h-4 w-4" aria-hidden />}
            {tab.label}
            {tab.count !== undefined && tab.count !== null && <span className="text-xs tabular-nums text-muted-foreground">{tab.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
