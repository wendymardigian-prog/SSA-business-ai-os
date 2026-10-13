"use client";

import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { GROUP_LABEL, GROUP_ORDER } from "@/lib/dashboards/ads-crm-columns";
import { moveColumn, orderedGroup, resetPrefs, toggleColumn, type ColumnPrefs } from "@/lib/dashboards/ads-columns";

/**
 * El selector de columnas: un checkbox por columna, agrupadas como en la tabla, con flechas para subir o bajar
 * cada una DENTRO de su grupo (con teclado funciona igual: son botones). Lo elegido se guarda por persona y
 * por pestaña (`useColumnPrefs`).
 */
export function ColumnsMenu({ prefs, onChange }: { prefs: ColumnPrefs; onChange: (next: ColumnPrefs) => void }) {
  const visible = new Set(prefs.visible);

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

      {GROUP_ORDER.map((group) => {
        const list = orderedGroup(prefs, group);
        return (
          <fieldset key={group} className="space-y-1">
            <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{GROUP_LABEL[group]}</legend>
            <ul className="space-y-0.5">
              {list.map((column, index) => (
                <li key={column.id} className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-accent/50">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={visible.has(column.id)}
                      onChange={() => onChange(toggleColumn(prefs, column.id))}
                      disabled={visible.has(column.id) && prefs.visible.length === 1}
                      className="h-3.5 w-3.5 shrink-0 accent-[var(--color-primary)]"
                    />
                    <span className="truncate">{column.label}</span>
                  </label>
                  <button
                    type="button"
                    aria-label={`Subir ${column.label}`}
                    disabled={index === 0}
                    onClick={() => onChange(moveColumn(prefs, column.id, -1))}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="h-3 w-3" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Bajar ${column.label}`}
                    disabled={index === list.length - 1}
                    onClick={() => onChange(moveColumn(prefs, column.id, 1))}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}

      <button type="button" onClick={() => onChange(resetPrefs())} className="h-8 w-full rounded-lg border border-border text-xs font-medium hover:bg-accent">
        Restablecer columnas
      </button>
    </Popover>
  );
}
