"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Columns3, Search } from "lucide-react";
import { FilterMenu, MenuGroupLabel } from "@/components/ui/filter-menu";
import {
  COLUMNS_STORAGE_KEY,
  allColumnKeys,
  columnMenuGroups,
  defaultVisibleKeys,
  parseColumnPrefs,
  serializeColumnPrefs,
  toggleColumnKey,
} from "@/lib/contacts/columns";
import type { ContactColumnDef } from "@/lib/contacts/filters/types";

/**
 * El selector de columnas de la lista de contactos: un buscador arriba (son
 * muchas), las columnas agrupadas como en el catálogo y un checkbox por
 * columna. "Nombre" no se puede ocultar. Toda la lógica vive en
 * `lib/contacts/columns.ts`; esto solo la compone.
 */

/**
 * Qué columnas ve cada persona. Vive en `localStorage` (siempre en try/catch;
 * sin poder leerlo, las de por defecto). Con `useSyncExternalStore`, así el
 * servidor dibuja las de por defecto y el navegador las de la persona sin un
 * render de más.
 */
const COLUMNS_EVENT = "contacts:columns-changed";
function subscribeColumns(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(COLUMNS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COLUMNS_EVENT, onChange);
  };
}
function readColumns(): string | null {
  try {
    return window.localStorage.getItem(COLUMNS_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useColumnPrefs(defs: readonly ContactColumnDef[]) {
  const raw = useSyncExternalStore(subscribeColumns, readColumns, () => null);
  // `defs` llega memorizada desde la lista: cambia solo si cambian los campos personalizados.
  const visible = useMemo(() => parseColumnPrefs(raw, defs), [raw, defs]);

  function save(next: readonly string[]) {
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, serializeColumnPrefs(next));
    } catch {
      // Sin almacenamiento: la elección no se guarda.
    }
    window.dispatchEvent(new Event(COLUMNS_EVENT));
  }

  return {
    visible,
    toggle: (key: string) => save(toggleColumnKey(visible, key, defs)),
    showAll: () => save(allColumnKeys(defs)),
    reset: () => save(defaultVisibleKeys(defs)),
  };
}

export function ContactColumnsMenu({
  defs,
  visible,
  onToggle,
  onShowAll,
  onReset,
}: {
  defs: readonly ContactColumnDef[];
  visible: readonly string[];
  onToggle: (key: string) => void;
  onShowAll: () => void;
  onReset: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = new Set(visible);
  const groups = columnMenuGroups(defs, query);
  const hiddenCount = defs.filter((c) => !shown.has(c.key)).length;

  return (
    <FilterMenu
      label="Columnas"
      compact
      active={false}
      icon={<Columns3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
      menuClassName="topbar:w-[300px]"
    >
      <div className="space-y-1 px-1.5 pb-1.5">
        <label className="relative block pt-1">
          <span className="sr-only">Buscar una columna</span>
          <Search className="pointer-events-none absolute left-2 top-1/2 mt-0.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar una columna…"
            className="h-8 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {groups.length === 0 && (
          <p role="status" className="px-2 py-4 text-center text-xs text-muted-foreground">
            Ninguna columna coincide con «{query}».
          </p>
        )}

        {groups.map(({ group, columns }) => (
          <div key={group.key}>
            <MenuGroupLabel>{group.label}</MenuGroupLabel>
            {columns.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-accent has-[:disabled]:cursor-default has-[:disabled]:opacity-70"
              >
                <input
                  type="checkbox"
                  checked={shown.has(c.key)}
                  disabled={!c.hideable}
                  onChange={() => onToggle(c.key)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {!c.hideable && <span className="text-[11px] text-muted-foreground">Siempre</span>}
              </label>
            ))}
          </div>
        ))}

        <div className="flex gap-1.5 border-t border-border pt-2">
          <button
            type="button"
            onClick={onShowAll}
            disabled={hiddenCount === 0}
            className="h-8 flex-1 rounded-lg border border-border text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Mostrar todo
          </button>
          <button type="button" onClick={onReset} className="h-8 flex-1 rounded-lg border border-border text-xs font-medium hover:bg-accent">
            Restablecer
          </button>
        </div>
      </div>
    </FilterMenu>
  );
}
