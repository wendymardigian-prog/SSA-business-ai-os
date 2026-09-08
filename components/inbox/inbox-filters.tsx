"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X, Loader2 } from "lucide-react";
import { toggleListParam } from "@/lib/url-params";
import { DATE_PRESETS, DATE_PRESET_LABELS } from "@/lib/dates";
import {
  INBOX_STATUS_VALUES,
  INBOX_STATUS_LABELS,
  ASSIGNMENT_UNASSIGNED,
  ASSIGNMENT_AI,
  countActiveFilters,
  type InboxFilters,
} from "@/lib/inbox/filters";
import { cn } from "@/lib/utils";

/**
 * Barra de filtros de la bandeja (F16).
 *
 * Todo el estado vive en la URL, no acá: un cambio de filtro es una
 * navegacion, el servidor rehace la consulta y la lista llega ya filtrada. Es
 * lo que permite compartir una vista filtrada por link, y lo unico que hace
 * que el filtro no mienta cuando hay mas conversaciones que las que entran en
 * una pagina.
 *
 * Los filtros que ocupan lugar (canal, tags, fecha) viven en un panel que se
 * abre: la columna de la bandeja tiene 320px y no entran cuatro desplegables.
 */

export function InboxFiltersBar({
  filters,
  tags,
  platforms,
  members,
}: {
  filters: InboxFilters;
  tags: { id: string; name: string; color: string | null }[];
  platforms: { value: string; label: string }[];
  members: { userId: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(filters.search);

  const activeCount = countActiveFilters(filters);

  /**
   * Cambiar cualquier filtro vuelve a la pagina 1: quedarse en la 3 despues de
   * filtrar deja la pantalla vacia sin explicacion.
   */
  function apply(next: URLSearchParams) {
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    apply(next);
  }

  function toggle(key: string, value: string) {
    apply(toggleListParam(new URLSearchParams(searchParams.toString()), key, value));
  }

  function clearAll() {
    setSearchDraft("");
    setOpen(false);
    // Se conserva la conversacion abierta: limpiar los filtros no deberia
    // cerrar el hilo que se estaba leyendo.
    const next = new URLSearchParams();
    const current = searchParams.get("c");
    if (current) next.set("c", current);
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <div className="border-b border-border">
      <div className="flex items-center gap-2 px-4 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", searchDraft.trim());
          }}
          className="relative flex-1"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Buscar por nombre..."
            aria-label="Buscar conversaciones"
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </form>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Filtros"
          className={cn(
            "relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border transition-colors",
            open || activeCount > 0
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-accent",
          )}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <SlidersHorizontal className="h-4 w-4" />
          )}
          {activeCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex gap-1 px-4 pb-3">
        {INBOX_STATUS_VALUES.map((value) => (
          <button
            key={value}
            onClick={() => setParam("estado", value)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              filters.status === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {INBOX_STATUS_LABELS[value]}
          </button>
        ))}
      </div>

      {open && (
        <div className="space-y-4 border-t border-border px-4 py-3">
          <FilterGroup label="Canal">
            {platforms.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">No hay canales conectados.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {platforms.map((p) => (
                  <Chip
                    key={p.value}
                    active={filters.platforms.includes(p.value)}
                    onClick={() => toggle("canal", p.value)}
                  >
                    {p.label}
                  </Chip>
                ))}
              </div>
            )}
          </FilterGroup>

          <FilterGroup label="Tags">
            {tags.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">Todavía no hay tags.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Chip
                    key={tag.id}
                    active={filters.tagIds.includes(tag.id)}
                    onClick={() => toggle("tag", tag.id)}
                  >
                    {tag.name}
                  </Chip>
                ))}
              </div>
            )}
          </FilterGroup>

          <FilterGroup label="Asignación">
            <select
              value={filters.assignment}
              onChange={(e) => setParam("asignado", e.target.value)}
              aria-label="Filtrar por asignación"
              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Todas</option>
              <option value={ASSIGNMENT_UNASSIGNED}>Sin asignar</option>
              <option value={ASSIGNMENT_AI}>Agente IA</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.label}
                </option>
              ))}
            </select>
          </FilterGroup>

          <FilterGroup label="Último mensaje">
            <select
              value={filters.datePreset}
              onChange={(e) => setParam("fecha", e.target.value)}
              aria-label="Filtrar por fecha del último mensaje"
              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Cualquier fecha</option>
              {DATE_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {DATE_PRESET_LABELS[preset]}
                </option>
              ))}
            </select>

            {filters.datePreset === "custom" && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setParam("desde", e.target.value)}
                  aria-label="Desde"
                  className="flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-xs text-muted-foreground">a</span>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setParam("hasta", e.target.value)}
                  aria-label="Hasta"
                  className="flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
          </FilterGroup>
        </div>
      )}

      {activeCount > 0 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <span className="text-xs text-muted-foreground">
            {activeCount === 1 ? "1 filtro activo" : `${activeCount} filtros activos`}
          </span>
          <button
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 font-medium text-primary"
          : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
