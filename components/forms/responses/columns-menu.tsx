"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Columns3, Search } from "lucide-react";
import { FilterMenu, MenuGroupLabel } from "@/components/ui/filter-menu";
import {
  EMPTY_COLUMN_PREFS,
  columnMenuGroups,
  parseColumnPrefs,
  responseColumnsStorageKey,
  serializeColumnPrefs,
  showAllColumns,
  toggleColumn,
  visibleColumns,
  type ResponseColumnDef,
  type ResponseColumnPrefs,
} from "@/lib/forms/response-columns";

const COLUMNS_EVENT = "form-responses:columns-changed";

function subscribeColumns(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(COLUMNS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COLUMNS_EVENT, onChange);
  };
}

/**
 * Qué columnas ve cada persona en cada formulario. Vive en `localStorage` (siempre en try/catch; sin poder leerlo, las
 * normales). Con `useSyncExternalStore`, el servidor dibuja las normales y el navegador las de la persona.
 */
export function useResponseColumnPrefs(formId: string, defs: readonly ResponseColumnDef[]) {
  const storageKey = responseColumnsStorageKey(formId);
  const read = useCallback(() => {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }, [storageKey]);
  const raw = useSyncExternalStore(subscribeColumns, read, () => null);
  const prefs = useMemo(() => parseColumnPrefs(raw), [raw]);
  const visible = useMemo(() => visibleColumns(defs, prefs), [defs, prefs]);

  function save(next: ResponseColumnPrefs) {
    try {
      window.localStorage.setItem(storageKey, serializeColumnPrefs(next));
    } catch {
      // Sin almacenamiento: la elección no se guarda.
    }
    window.dispatchEvent(new Event(COLUMNS_EVENT));
  }

  return {
    visible,
    toggle: (def: ResponseColumnDef) => save(toggleColumn(prefs, def)),
    showAll: () => save(showAllColumns(defs)),
    reset: () => save(EMPTY_COLUMN_PREFS),
  };
}

/** El selector de columnas: un buscador arriba (son muchas), agrupadas, con un checkbox por columna. */
export function ResponseColumnsMenu({
  defs,
  visible,
  onToggle,
  onShowAll,
  onReset,
}: {
  defs: readonly ResponseColumnDef[];
  visible: readonly ResponseColumnDef[];
  onToggle: (def: ResponseColumnDef) => void;
  onShowAll: () => void;
  onReset: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = new Set(visible.map((def) => def.key));
  const groups = columnMenuGroups(defs, query);

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

        {groups.map((group) => (
          <div key={group.key}>
            <MenuGroupLabel>{group.label}</MenuGroupLabel>
            {group.columns.map((def) => (
              <label key={def.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-accent">
                <input type="checkbox" checked={shown.has(def.key)} onChange={() => onToggle(def)} className="h-4 w-4 accent-primary" />
                <span className="min-w-0 flex-1 truncate">{def.label}</span>
              </label>
            ))}
          </div>
        ))}

        <div className="flex gap-1.5 border-t border-border pt-2">
          <button type="button" onClick={onShowAll} disabled={shown.size === defs.length} className="h-8 flex-1 rounded-lg border border-border text-xs font-medium hover:bg-accent disabled:opacity-50">
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
