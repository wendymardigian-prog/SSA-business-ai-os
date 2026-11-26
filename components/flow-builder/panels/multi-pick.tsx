"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Search, X } from "lucide-react";
import {
  isEmptyScope,
  staleScopeIds,
  toggleScopeProduct,
  toggleScopeVariant,
  type ProductScope,
  type ScopeCatalogProduct,
} from "@/lib/automations/product-scope";
import { Tip } from "@/components/ui/tooltip";

/**
 * Los selectores de elección múltiple de los filtros de un disparador: chips que se prenden y apagan. Sin elegir
 * nada, vale para todos (nunca «ninguno»). Lo elegido que ya no existe queda a la vista con su aviso, para que la
 * persona lo saque: vaciarlo solo cambiaría el filtro a «todos» sin que nadie lo decida.
 */

const chip = (on: boolean) =>
  on
    ? "rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-300"
    : "rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted";

const SEARCH_FROM = 8;

export interface PickOption {
  value: string;
  label: string;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative mb-1.5">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        aria-label={`Buscar en ${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar…"
        className="w-full rounded-lg border border-border bg-card py-1.5 pl-7 pr-2 text-xs text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

function StaleChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Tip asChild content="Sacar">
      <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        {label}
        <X className="h-3 w-3" aria-hidden />
      </button>
    </Tip>
  );
}

const matches = (label: string, q: string) => label.toLocaleLowerCase("es").includes(q.trim().toLocaleLowerCase("es"));

/** Una lista de opciones planas. */
export function MultiPick({
  label,
  value,
  options,
  onChange,
  loaded = true,
  hint,
}: {
  label: string;
  value: readonly string[];
  options: readonly PickOption[];
  onChange: (next: string[]) => void;
  /** Ya llegaron las opciones. Sin esto, «Cargando…» en lugar de «No hay opciones». */
  loaded?: boolean;
  hint?: string;
}) {
  const [q, setQ] = useState("");
  const selected = value.filter(Boolean);
  const known = new Set(options.map((o) => o.value));
  const stale = loaded ? selected.filter((v) => !known.has(v)) : [];
  const visible = q ? options.filter((o) => matches(o.label, q) || selected.includes(o.value)) : options;
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-foreground">{label}</span>
      {options.length >= SEARCH_FROM && <SearchBox value={q} onChange={setQ} label={label} />}
      {options.length === 0 && stale.length === 0 ? (
        <p className="text-xs text-muted-foreground">{loaded ? "No hay opciones todavía: vale para cualquiera." : "Cargando…"}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {visible.map((o) => (
            <button key={o.value} type="button" aria-pressed={selected.includes(o.value)} onClick={() => onChange(toggle(selected, o.value))} className={chip(selected.includes(o.value))}>
              {o.label}
            </button>
          ))}
          {stale.map((v) => (
            <StaleChip key={v} label="Ya no existe" onRemove={() => onChange(selected.filter((x) => x !== v))} />
          ))}
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">{hint ?? "Sin elegir nada, vale para cualquiera."}</p>
    </div>
  );
}

/**
 * Productos y variantes: un producto se elige entero (todas sus variantes, también las que se creen) o se eligen
 * variantes sueltas debajo. Sin elegir nada, vale para todos los productos, también los nuevos.
 */
export function ProductScopePick({
  label = "Productos y variantes",
  scope,
  catalog,
  onChange,
  loaded = true,
  hint,
}: {
  label?: string;
  scope: ProductScope;
  catalog: readonly ScopeCatalogProduct[] | null | undefined;
  onChange: (next: ProductScope) => void;
  loaded?: boolean;
  hint?: string;
}) {
  const [q, setQ] = useState("");
  const products = useMemo(() => catalog ?? [], [catalog]);
  const stale = loaded && catalog ? staleScopeIds(scope, products) : { products: [], variants: [] };
  const visible = q
    ? products.filter((p) => matches(p.name, q) || p.variants.some((v) => matches(v.name, q)) || scope.productIds.includes(p.id) || p.variants.some((v) => scope.variantIds.includes(v.id)))
    : products;

  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-foreground">{label}</span>
      {products.length >= SEARCH_FROM && <SearchBox value={q} onChange={setQ} label={label} />}
      {!loaded || catalog === undefined ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : catalog === null ? (
        <p role="alert" className="text-xs text-destructive">No pude leer los productos. Cerrá el panel y volvé a abrirlo.</p>
      ) : products.length === 0 && stale.products.length + stale.variants.length === 0 ? (
        <p className="text-xs text-muted-foreground">Todavía no hay productos: vale para cualquiera.</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((p) => {
            const whole = scope.productIds.includes(p.id);
            return (
              <li key={p.id} className="rounded-lg border border-border p-2">
                <button type="button" aria-pressed={whole} onClick={() => onChange(toggleScopeProduct(scope, p))} className={chip(whole)}>
                  {p.name}
                  {whole && p.variants.length > 1 ? " · todas las variantes" : ""}
                </button>
                {!whole && p.variants.length > 1 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5 pl-3">
                    {p.variants.map((v) => {
                      const on = scope.variantIds.includes(v.id);
                      return (
                        <button key={v.id} type="button" aria-pressed={on} onClick={() => onChange(toggleScopeVariant(scope, p.id, v.id))} className={chip(on)}>
                          {v.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {!whole && p.variants.length === 1 && scope.variantIds.includes(p.variants[0].id) && (
                  <p className="mt-1 pl-3 text-[11px] text-muted-foreground">Solo la variante {p.variants[0].name}.</p>
                )}
              </li>
            );
          })}
          {(stale.products.length > 0 || stale.variants.length > 0) && (
            <li className="flex flex-wrap gap-1.5">
              {stale.products.map((id) => (
                <StaleChip key={id} label="Producto que ya no existe" onRemove={() => onChange({ ...scope, productIds: scope.productIds.filter((x) => x !== id) })} />
              ))}
              {stale.variants.map((id) => (
                <StaleChip key={id} label="Variante que ya no existe" onRemove={() => onChange({ ...scope, variantIds: scope.variantIds.filter((x) => x !== id) })} />
              ))}
            </li>
          )}
        </ul>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {hint ?? (isEmptyScope(scope) ? "Sin elegir nada, vale para todos los productos, también los que crees más adelante." : "Un producto elegido entero incluye sus variantes nuevas. Tocá el nombre de un producto para elegirlo entero, o sus variantes para elegir solo esas.")}
      </p>
    </div>
  );
}
