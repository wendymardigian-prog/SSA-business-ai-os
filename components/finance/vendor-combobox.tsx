"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { canCreateVendor, searchVendors } from "@/lib/finance/vendor-search";
import type { VendorLite } from "@/lib/finance/vendors";

/**
 * Buscador de proveedores con alta en línea. Escribís, elegís uno de la lista o creás uno nuevo con
 * «+ Nuevo proveedor: {texto}» (solo el nombre) y queda seleccionado SIN cerrar el formulario de afuera.
 *
 * Accesible: es un `combobox` con lista (`listbox`), se maneja con las flechas, Enter elige, Esc cierra y la
 * opción activa se anuncia con `aria-activedescendant`. Las opciones se eligen con `onMouseDown` para que el
 * campo no pierda el foco antes del clic.
 */
export type CreateVendorResult = { ok: true; vendor: VendorLite } | { ok: false; error: string; existing?: VendorLite | null };

export function VendorCombobox({
  id,
  vendors,
  value,
  onChange,
  onCreate,
  disabled = false,
}: {
  id: string;
  /** Los proveedores que se pueden elegir (los activos y, si el gasto ya tiene uno archivado, ese). */
  vendors: readonly VendorLite[];
  value: string | null;
  onChange: (vendorId: string | null) => void;
  /** Sin esto no se ofrece crear. */
  onCreate?: (name: string) => Promise<CreateVendorResult>;
  disabled?: boolean;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = vendors.find((v) => v.id === value) ?? null;
  const found = useMemo(() => searchVendors(vendors, query), [vendors, query]);
  const canCreate = !!onCreate && canCreateVendor(vendors, query);
  const optionCount = found.length + (canCreate ? 1 : 0);

  function choose(vendor: VendorLite | null) {
    onChange(vendor?.id ?? null);
    setQuery("");
    setOpen(false);
    setError(null);
  }

  async function create() {
    if (!onCreate || creating) return;
    setCreating(true);
    setError(null);
    const result = await onCreate(query.trim());
    setCreating(false);
    if (result.ok) return choose(result.vendor);
    // Ya existía uno activo con ese nombre: se deja elegido ese en vez de duplicarlo.
    if (result.existing) {
      setError(`${result.error}. Lo elegí por vos.`);
      onChange(result.existing.id);
      setQuery("");
      setOpen(false);
      return;
    }
    setError(result.error);
  }

  function pick(index: number) {
    if (index < found.length) choose(found[index]);
    else if (canCreate) void create();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(optionCount - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      if (open && optionCount > 0) {
        event.preventDefault();
        pick(Math.min(active, optionCount - 1));
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setQuery("");
      }
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && optionCount > 0 ? `${listId}-${Math.min(active, optionCount - 1)}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={open ? query : (selected?.name ?? "")}
          placeholder={open ? "Buscá o escribí un proveedor nuevo" : "Sin proveedor"}
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setActive(0);
          }}
          onBlur={() => {
            setOpen(false);
            setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="w-full rounded-lg border border-border bg-background py-2 pl-3 pr-9 text-sm disabled:opacity-60"
        />
        {selected && !disabled && (
          <button
            type="button"
            aria-label="Quitar el proveedor"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              choose(null);
              input.current?.focus();
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Proveedores"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm shadow-lg"
        >
          {found.map((v, i) => (
            <li
              key={v.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={v.id === value}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(v);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${i === active ? "bg-accent" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
              {v.archived_at && <span className="text-[11px] text-muted-foreground">archivado</span>}
              {v.id === value && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
            </li>
          ))}
          {canCreate && (
            <li
              id={`${listId}-${found.length}`}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                void create();
              }}
              onMouseEnter={() => setActive(found.length)}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-primary ${active === found.length ? "bg-accent" : ""}`}
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">Nuevo proveedor: {query.trim()}</span>
            </li>
          )}
          {optionCount === 0 && <li role="presentation" className="px-2 py-1.5 text-muted-foreground">{query.trim() ? "Ningún proveedor coincide." : "Todavía no hay proveedores. Escribí un nombre para crear el primero."}</li>}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
