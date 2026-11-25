"use client";

/**
 * El selector de variables de los pasos del lienzo (24/11/2026), al estilo de GoHighLevel: un botón «Insertar variable»
 * que abre la lista agrupada (Contacto, Campos personalizados, Empresa, Venta, Reunión…), cada variable con su nombre
 * en castellano y su `{{ruta}}`, y un buscador. La lista la arma el panel lateral con `pickerVariables`
 * (lib/flow-engine/variable-catalog.ts): solo las que de verdad se resuelven en este paso. Los nombres y los grupos
 * salen de `lib/flow-engine/variable-labels.ts`; el panel lateral pasa los rótulos del disparador y los nombres de los
 * campos personalizados con `VariableLabelsProvider`.
 */

import { createContext, useContext, useId, useMemo, useState } from "react";
import { Braces, ChevronDown, Search } from "lucide-react";
import { filterVariableGroups, groupVariables, type VariableLabelSources } from "@/lib/flow-engine/variable-labels";

const VariableLabelsContext = createContext<VariableLabelSources>({});

export const VariableLabelsProvider = VariableLabelsContext.Provider;

/** Con más de esto, el selector muestra el buscador. */
const SEARCH_FROM = 12;

export function VariableChips({
  variables,
  onInsert,
  hint = "Tocá una variable para agregarla.",
}: {
  variables?: string[];
  /** Recibe el token listo para pegar (`{{contact.first_name}}`) y la ruta sola (`contact.first_name`). */
  onInsert: (token: string, variable: string) => void;
  hint?: string;
}) {
  const sources = useContext(VariableLabelsContext);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const groups = useMemo(() => groupVariables(variables ?? [], sources), [variables, sources]);
  const visible = useMemo(() => filterVariableGroups(groups, query), [groups, query]);

  if (!variables || variables.length === 0) return null;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
      >
        <Braces className="h-3 w-3" aria-hidden />
        Insertar variable
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div id={listId} className="mt-1.5 rounded-md border border-border bg-card">
          <p className="px-2 pt-1.5 text-[11px] text-muted-foreground">{hint}</p>
          {variables.length > SEARCH_FROM && (
            <div className="relative px-2 pt-1.5">
              <Search className="pointer-events-none absolute left-4 top-1/2 mt-0.5 h-3 w-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar variable"
                aria-label="Buscar variable"
                className="w-full rounded-md border border-border bg-card py-1 pl-6 pr-2 text-xs text-foreground placeholder:text-disabled-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto px-2 pb-2">
            {visible.length === 0 && <p className="py-2 text-[11px] text-muted-foreground">No hay ninguna variable con ese nombre.</p>}
            {visible.map((group) => (
              <div key={group.group} className="pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.group}</p>
                <ul className="mt-0.5">
                  {group.items.map((item) => (
                    <li key={item.path}>
                      <button
                        type="button"
                        onClick={() => {
                          onInsert(`{{${item.path}}}`, item.path);
                          setOpen(false);
                          setQuery("");
                        }}
                        className="flex w-full flex-col items-start rounded px-1.5 py-1 text-left hover:bg-blue-50 dark:hover:bg-blue-950/40"
                      >
                        <span className="text-xs text-foreground">{item.label}</span>
                        {item.label !== item.path && <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400">{`{{${item.path}}}`}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
