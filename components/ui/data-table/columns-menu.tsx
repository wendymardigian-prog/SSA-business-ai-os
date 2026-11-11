"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Columns3, GripVertical, Pin, Search } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { isColumnVisible, isDefaultPrefs, menuSections, moveColumn, moveColumnTo, resetColumns, resetWidths, showAllColumns, toggleColumn, togglePinned } from "@/lib/ui/data-table/prefs";
import type { TablePrefsState } from "./use-table-prefs";

/**
 * El menú «Columnas» de TODAS las tablas del sistema: buscador, un tilde por columna, orden (flechas y arrastre), alfiler
 * para fijar a la izquierda y «Restablecer». Lo elegido se aplica en el momento y se guarda en una vista desde el menú de vistas.
 * Va en la barra superior, como un botón de solo icono.
 */
export function ColumnsMenu({ state }: { state: TablePrefsState }) {
  const { prefs, metas, update } = state;
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const sections = menuSections(metas, prefs, query);
  const byKey = new Map(metas.map((m) => [m.key, m]));
  const customized = !isDefaultPrefs(prefs);
  const searching = query.trim().length > 0;
  const lastKey = (group: string) => sections.find((s) => s.group === group)?.keys.at(-1);

  return (
    <Popover
      label="Columnas"
      triggerClassName={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[13px] font-medium transition-colors ${customized ? "border-primary-edge bg-primary/10" : "border-input bg-background hover:border-muted-foreground/60"}`}
      trigger={
        <>
          <Columns3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="sr-only">Columnas</span>
        </>
      }
      panelClassName="w-[min(20rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto space-y-3"
      align="end"
    >
      <p className="text-[11px] text-muted-foreground">Elegí qué columnas ver, su orden y cuáles quedan fijas. El ancho se cambia arrastrando el borde del título.</p>

      <label className="relative block">
        <span className="sr-only">Buscar una columna</span>
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar una columna…"
          className="h-8 w-full rounded-lg border border-border bg-background pl-7 pr-2 text-xs placeholder:text-muted-foreground/70 focus:border-primary-edge focus:outline-none focus:ring-1 focus:ring-primary-edge"
        />
      </label>

      {sections.length === 0 && <p role="status" className="py-4 text-center text-xs text-muted-foreground">Ninguna columna coincide con «{query}».</p>}

      {sections.map((section) => (
        <fieldset key={section.group || "main"} className="space-y-0.5">
          {section.label && <legend className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{section.label}</legend>}
          <ul className="space-y-0.5">
            {section.keys.map((key, index) => {
              const meta = byKey.get(key)!;
              const label = meta.label || "Acciones";
              const pinned = prefs.pinned.includes(key);
              return (
                <li
                  key={key}
                  draggable={!searching}
                  onDragStart={(e) => {
                    setDragging(key);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", key);
                  }}
                  onDragOver={(e) => {
                    if (dragging && dragging !== key) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging) update((current) => moveColumnTo(metas, current, dragging, key));
                    setDragging(null);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-accent/50 ${dragging === key ? "opacity-50" : ""}`}
                >
                  {!searching && <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/60" aria-hidden />}
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={isColumnVisible(meta, prefs)}
                      disabled={meta.hideable === false}
                      onChange={() => update((current) => toggleColumn(metas, current, key))}
                      className="h-3.5 w-3.5 shrink-0 accent-[var(--color-primary)]"
                    />
                    <span className="truncate">{label}</span>
                  </label>
                  {meta.pinnable !== false && (
                    <button
                      type="button"
                      onClick={() => update((current) => togglePinned(metas, current, key))}
                      aria-pressed={pinned}
                      aria-label={pinned ? `Soltar ${label}` : `Fijar ${label} a la izquierda`}
                      title={pinned ? "Fijada a la izquierda. Clic para soltarla." : "Fijar a la izquierda"}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-accent ${pinned ? "text-primary-ink" : "text-muted-foreground/50 hover:text-foreground"}`}
                    >
                      <Pin className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                  {!searching && (
                    <>
                      <button
                        type="button"
                        aria-label={`Subir ${label}`}
                        disabled={index === 0}
                        onClick={() => update((current) => moveColumn(metas, current, key, -1))}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowUp className="h-3 w-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Bajar ${label}`}
                        disabled={key === lastKey(section.group)}
                        onClick={() => update((current) => moveColumn(metas, current, key, 1))}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowDown className="h-3 w-3" aria-hidden />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
      {searching && sections.length > 0 && <p className="text-[11px] text-muted-foreground">Para reordenar, borrá la búsqueda.</p>}

      <div className="grid grid-cols-3 gap-1.5">
        <button type="button" onClick={() => update((current) => showAllColumns(metas, current))} className="h-8 rounded-lg border border-border text-[11px] font-medium hover:bg-accent">
          Mostrar todas
        </button>
        <button type="button" onClick={() => update((current) => resetColumns(current))} className="h-8 rounded-lg border border-border text-[11px] font-medium hover:bg-accent">
          Restablecer
        </button>
        <button type="button" onClick={() => update((current) => resetWidths(current))} className="h-8 rounded-lg border border-border text-[11px] font-medium hover:bg-accent">
          Anchos
        </button>
      </div>
    </Popover>
  );
}
