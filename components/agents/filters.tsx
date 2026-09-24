"use client";

import { useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { DATE_PRESETS, DATE_PRESET_LABELS } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Piezas de filtro y paginacion para las pestanas de observabilidad (Runs,
 * Acciones, Costos). El estado vive en la URL, como en la bandeja y el CRM:
 * cambiar un filtro es una navegacion y el servidor rehace la consulta.
 *
 * Cambiar cualquier filtro vuelve a la pagina 1, y se conserva `tab`.
 */

export function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  function apply(next: URLSearchParams, keepPage = false) {
    if (!keepPage) next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    apply(next);
  }
  function setPage(page: number) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(page));
    apply(next, true);
  }
  function clearAll(keep: string[] = ["tab"]) {
    const next = new URLSearchParams();
    for (const k of keep) {
      const v = searchParams.get(k);
      if (v) next.set(k, v);
    }
    apply(next);
  }
  return { pending, setParam, setPage, clearAll, get: (key: string) => searchParams.get(key) ?? "" };
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "todos",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
        value ? "border-primary text-foreground" : "border-input text-muted-foreground",
      )}
    >
      <option value="">
        {label}: {allLabel}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DateFilter({
  preset,
  from,
  to,
  setParam,
  label = "Período",
}: {
  preset: string;
  from: string;
  to: string;
  setParam: (key: string, value: string) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect
        label={label}
        allLabel="cualquiera"
        value={preset}
        onChange={(v) => setParam("fecha", v)}
        options={DATE_PRESETS.map((p) => ({ value: p, label: DATE_PRESET_LABELS[p] }))}
      />
      {preset === "custom" && (
        <>
          <input type="date" value={from} onChange={(e) => setParam("desde", e.target.value)} aria-label="Desde" className="rounded-lg border border-input bg-background px-2 py-2 text-sm" />
          <span className="text-xs text-muted-foreground">a</span>
          <input type="date" value={to} onChange={(e) => setParam("hasta", e.target.value)} aria-label="Hasta" className="rounded-lg border border-input bg-background px-2 py-2 text-sm" />
        </>
      )}
    </div>
  );
}

export function FilterBar({ children, activeCount, onClear, pending }: { children: ReactNode; activeCount: number; onClear: () => void; pending: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Cargando" />}
      </div>
      {activeCount > 0 && (
        <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <X className="h-3 w-3" />
          Limpiar filtros ({activeCount})
        </button>
      )}
    </div>
  );
}

export function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-border pt-3">
      <span className="text-xs text-muted-foreground">
        Página {page} de {last} · {total} en total
      </span>
      <div className="flex gap-1">
        <PageButton disabled={page <= 1} onClick={() => onPage(page - 1)} label="Anterior">
          <ChevronLeft className="h-3.5 w-3.5" />
        </PageButton>
        <PageButton disabled={page >= last} onClick={() => onPage(page + 1)} label="Siguiente">
          <ChevronRight className="h-3.5 w-3.5" />
        </PageButton>
      </div>
    </div>
  );
}

function PageButton({ disabled, onClick, label, children }: { disabled: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** Dos vacios distintos: "todavia no hay nada" y "el filtro no encontro". */
export function EmptyState({ icon, title, text, filtered, onClear }: { icon: ReactNode; title: string; text: string; filtered: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
      <div className="text-muted-foreground/40">{icon}</div>
      <p className="mt-3 text-sm font-medium">{filtered ? "Nada coincide con estos filtros" : title}</p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">{filtered ? "Probá con otro período o quitá algún filtro." : text}</p>
      {filtered && (
        <button type="button" onClick={onClear} className="mt-3 rounded-lg border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `USD ${value.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: value < 0.01 ? 4 : 2 })}`;
}
