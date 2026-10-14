"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Columns3, GripVertical, Search } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import type { ColumnId } from "@/lib/dashboards/ads-crm-columns";
import { menuGroups, moveColumn, moveColumnTo, resetPrefs, toggleColumn, type ColumnLevel, type ColumnPrefs } from "@/lib/dashboards/ads-columns";

/**
 * El selector de columnas (Tirón 2, E4): un buscador arriba (son muchas), las columnas agrupadas como en la tabla (en Meta, con
 * subtítulos: Entrega, Clics, Video, Conversiones y Calidad), un checkbox por columna y dos formas de reordenar DENTRO de su bloque:
 * las flechas (botones, funcionan con teclado) y arrastrar el asa. Lo elegido se guarda por persona y por pestaña (`useColumnPrefs`).
 * Toda la lógica (qué se muestra, el filtro, el orden) está en `lib/dashboards/ads-columns.ts`.
 */
export function ColumnsMenu({ prefs, onChange, level }: { prefs: ColumnPrefs; onChange: (next: ColumnPrefs) => void; level: ColumnLevel }) {
  const visible = new Set(prefs.visible);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<ColumnId | null>(null);
  const groups = menuGroups(prefs, level, query);

  return (
    <Popover
      label="Columnas"
      triggerClassName="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs transition-colors hover:bg-accent"
      trigger={
        <>
          <Columns3 className="h-3.5 w-3.5" aria-hidden />
          <span>Columnas</span>
        </>
      }
      panelClassName="w-80 max-h-[70vh] overflow-y-auto space-y-3"
      align="end"
    >
      <p className="text-[11px] text-muted-foreground">Elegí qué columnas ver y su orden. Se recuerda para vos, en cada pestaña.</p>

      <label className="relative block">
        <span className="sr-only">Buscar una columna</span>
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar una columna…"
          className="h-8 w-full rounded-lg border border-border bg-background pl-7 pr-2 text-xs placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </label>

      {groups.length === 0 && <p role="status" className="py-4 text-center text-xs text-muted-foreground">Ninguna columna coincide con «{query}».</p>}

      {groups.map(({ group, label, sections }) => (
        <fieldset key={group} className="space-y-1.5">
          <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</legend>
          {sections.map((section) => (
            <div key={section.subgroup ?? "main"} className="space-y-0.5">
              {section.label && <p className="pl-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">{section.label}</p>}
              <ul className="space-y-0.5">
                {section.columns.map((column, index) => (
                  <li
                    key={column.id}
                    draggable={!query}
                    onDragStart={(e) => {
                      setDragging(column.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", column.id);
                    }}
                    onDragOver={(e) => {
                      if (dragging && dragging !== column.id) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragging) onChange(moveColumnTo(prefs, dragging, column.id, level));
                      setDragging(null);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-accent/50 ${dragging === column.id ? "opacity-50" : ""}`}
                  >
                    {!query && <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/60" aria-hidden />}
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={visible.has(column.id)}
                        onChange={() => onChange(toggleColumn(prefs, column.id, level))}
                        className="h-3.5 w-3.5 shrink-0 accent-[var(--color-primary)]"
                      />
                      <span className="truncate">{column.label}</span>
                    </label>
                    {!query && (
                      <>
                        <button
                          type="button"
                          aria-label={`Subir ${column.label}`}
                          disabled={index === 0}
                          onClick={() => onChange(moveColumn(prefs, column.id, -1, level))}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`Bajar ${column.label}`}
                          disabled={index === section.columns.length - 1}
                          onClick={() => onChange(moveColumn(prefs, column.id, 1, level))}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </fieldset>
      ))}
      {query && groups.length > 0 && <p className="text-[11px] text-muted-foreground">Para reordenar, borrá la búsqueda.</p>}

      <button type="button" onClick={() => onChange(resetPrefs())} className="h-8 w-full rounded-lg border border-border text-xs font-medium hover:bg-accent">
        Restablecer columnas
      </button>
    </Popover>
  );
}
