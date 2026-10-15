"use client";

import { Loader2, Search, X } from "lucide-react";
import { useAsyncSearch } from "@/components/sales/use-async-search";
import { fieldInput } from "@/components/content/dialog";

/**
 * Un buscador con lista de resultados y la opcion elegida a la vista (con una X para cambiarla). Lo usan el selector
 * de canal de la venta (pieza, anuncio, contacto que refirio) y el filtro por pieza de la lista de Ventas.
 *
 * El componente no sabe que busca: recibe la funcion y como dibujar cada resultado.
 */
export function SearchPicker<T>({
  label,
  placeholder,
  search,
  getKey,
  renderOption,
  selectedLabel,
  onPick,
  onClear,
  disabled,
  emptyText = "No encontré nada con eso.",
}: {
  label: string;
  placeholder: string;
  search: (query: string) => Promise<T[]>;
  getKey: (option: T) => string;
  renderOption: (option: T) => React.ReactNode;
  /** Lo elegido, ya dicho en palabras. Con esto el buscador se reemplaza por la opcion elegida. */
  selectedLabel: string | null;
  onPick: (option: T) => void;
  onClear: () => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  const s = useAsyncSearch(search);

  if (selectedLabel) {
    return (
      <div className="space-y-1">
        <span className="block text-xs font-medium">{label}</span>
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 break-words">{selectedLabel}</span>
          <button type="button" onClick={onClear} disabled={disabled} aria-label={`Cambiar: ${label}`} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-50">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-xs font-medium">{label}</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={s.query}
            onChange={(e) => s.setQuery(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            className={`${fieldInput} pl-8`}
          />
          {s.searching && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
        </span>
      </label>
      {s.options.length > 0 && (
        <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border" aria-label={`Resultados: ${label}`}>
          {s.options.map((o) => (
            <li key={getKey(o)}>
              <button
                type="button"
                onClick={() => {
                  onPick(o);
                  s.reset();
                }}
                className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-accent"
              >
                {renderOption(o)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {s.query.trim().length >= 2 && !s.searching && s.options.length === 0 && <p className="text-xs text-muted-foreground">{emptyText}</p>}
    </div>
  );
}
