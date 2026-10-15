"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { FOCUS } from "./ui";

export interface RoleTabItem {
  key: string;
  name: string;
  count: number;
}

/**
 * Las pestañas por rol (Vendedor · Setter · Contenido · Pauta · los del negocio). Teclado: flechas izquierda y derecha
 * cambian de rol, Inicio y Fin van al primero y al último. En el celular se desplazan de costado dentro de su fila.
 */
export function RoleTabs({ tabs, active, onSelect, panelId }: { tabs: RoleTabItem[]; active: string; onSelect: (key: string) => void; panelId: string }) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const tab = tabs[next];
    onSelect(tab.key);
    refs.current.get(tab.key)?.focus();
  }

  return (
    <div role="tablist" aria-label="Roles de comisión" className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-border p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab, index) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              if (el) refs.current.set(tab.key, el);
              else refs.current.delete(tab.key);
            }}
            type="button"
            role="tab"
            id={`${panelId}-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors",
              FOCUS,
              selected ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {tab.name}
            <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
              {tab.count}<span className="sr-only"> {tab.count === 1 ? "regla" : "reglas"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
