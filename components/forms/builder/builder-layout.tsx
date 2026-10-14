"use client";

import { useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El esqueleto del constructor (plano formularios-ui, F9): el lienzo a la izquierda y el panel de ajustes a la
 * derecha (330 px, pegado arriba al desplazarse). En pantallas angostas el panel sale de abajo, como una hoja, con un
 * boton flotante "Ajustes": nunca se abre solo, para no tapar lo que se esta escribiendo.
 */
export function BuilderLayout({ canvas, title, subtitle, back, panel }: { canvas: ReactNode; title: string; subtitle?: string; back?: { label: string; onClick: () => void }; panel: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="min-w-0">{canvas}</div>

      <aside
        aria-label="Ajustes"
        className={cn(
          "rounded-xl border border-border bg-card p-4",
          "lg:sticky lg:top-0 lg:max-h-[calc(100vh-9rem)] lg:self-start lg:overflow-auto",
          "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:max-h-[75vh] max-lg:overflow-auto max-lg:rounded-b-none max-lg:shadow-2xl",
          !open && "max-lg:hidden",
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {back && (
              <button type="button" onClick={back.onClick} className="mb-0.5 text-xs text-muted-foreground underline hover:text-foreground">
                ← {back.label}
              </button>
            )}
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Cerrar ajustes" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-accent lg:hidden">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {panel}
      </aside>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg lg:hidden"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden /> Ajustes
        </button>
      )}
    </div>
  );
}
