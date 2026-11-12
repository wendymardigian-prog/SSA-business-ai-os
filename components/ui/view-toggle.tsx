"use client";

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

/**
 * El cambio de vista de la barra superior (Tabla ⇄ Tablero / Kanban), el mismo en todas las pantallas. Va en
 * `<PageHeader left={…} />`. Abajo de 640 px queda solo el ícono (el nombre sigue para el lector de pantalla).
 */
export interface ViewOption<T extends string> {
  value: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export function ViewToggle<T extends string>({
  options,
  value,
  onChange,
  label = "Vista",
}: {
  options: readonly ViewOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 rounded-lg bg-muted/60 p-0.5">
      {options.map(({ value: option, label: name, icon: Icon }) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => value !== option && onChange(option)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm max-topbar:h-10",
            value === option ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{name}</span>
          <span className="sr-only sm:hidden">{name}</span>
        </button>
      ))}
    </div>
  );
}
