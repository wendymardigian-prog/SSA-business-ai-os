"use client";

import { forwardRef, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { ASSET_KINDS, ASSET_KIND_PLURAL, type AssetKind } from "@/lib/response-assets/kind";
import { toggleTag, type AssetFilters, type KindFilter, type TagCount } from "@/lib/response-assets/list";
import { cn } from "@/lib/utils";
import { AssetKindIcon } from "./asset-kind-icon";

/**
 * Buscador + chips de tipo + chips de etiqueta. Uno solo para la pantalla de
 * gestion y para el widget del chat: los dos cuentan con las mismas
 * funciones (lib/response-assets/list.ts) y se ven igual.
 *
 * Un tipo con cero NO desaparece: queda en gris con su 0, porque si
 * desapareciera nadie descubriria que ese tipo existe. Un tipo que el canal
 * no acepta (`disabledKinds`) tampoco: queda deshabilitado con el motivo al
 * pasar el mouse, porque si desapareciera la persona creeria que no tiene el
 * recurso.
 */
export const AssetFilterBar = forwardRef<
  HTMLInputElement,
  {
    filters: AssetFilters;
    onChange: (filters: AssetFilters) => void;
    counts: Record<KindFilter, number>;
    tags: TagCount[];
    /** Tipos que no se pueden elegir aca, con el motivo (el canal no los acepta). */
    disabledKinds?: Partial<Record<AssetKind, string>>;
    compact?: boolean;
    placeholder?: string;
    onSearchKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    searchLabel?: string;
  }
>(function AssetFilterBar(
  { filters, onChange, counts, tags, disabledKinds = {}, compact = false, placeholder = "Buscar…", onSearchKeyDown, searchLabel = "Buscar recursos" },
  searchRef,
) {
  const chip = compact ? "h-7 px-2 text-[11px]" : "h-8 px-2.5 text-xs";

  return (
    <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          onKeyDown={onSearchKeyDown}
          placeholder={placeholder}
          aria-label={searchLabel}
          className={cn(
            "w-full rounded-lg border border-input bg-background pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
            compact ? "h-8" : "h-9",
          )}
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, query: "" })}
            aria-label="Borrar la búsqueda"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div role="group" aria-label="Filtrar por tipo" className="flex flex-wrap gap-1">
        <KindChip
          className={chip}
          active={filters.kind === "all"}
          count={counts.all}
          label="Todos"
          onClick={() => onChange({ ...filters, kind: "all" })}
        />
        {ASSET_KINDS.map((kind) => {
          const reason = disabledKinds[kind];
          return (
            <KindChip
              key={kind}
              className={chip}
              kind={kind}
              active={filters.kind === kind}
              count={counts[kind]}
              label={ASSET_KIND_PLURAL[kind]}
              disabledReason={reason}
              onClick={() => onChange({ ...filters, kind: filters.kind === kind ? "all" : kind })}
            />
          );
        })}
      </div>

      {tags.length > 0 && (
        <div role="group" aria-label="Filtrar por etiqueta" className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <button
              key={tag.tag}
              type="button"
              aria-pressed={tag.selected}
              onClick={() => onChange({ ...filters, tags: toggleTag(filters.tags, tag.tag) })}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 text-[11px] transition-colors",
                compact ? "h-6" : "h-7",
                tag.selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              #{tag.tag}
              <span className={cn("tabular-nums", tag.count === 0 && "opacity-50")}>{tag.count}</span>
              {tag.selected && <X className="h-3 w-3" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

function KindChip({
  kind,
  label,
  count,
  active,
  disabledReason,
  onClick,
  className,
}: {
  kind?: AssetKind;
  label: string;
  count: number;
  active: boolean;
  disabledReason?: string;
  onClick: () => void;
  className: string;
}) {
  const disabled = Boolean(disabledReason);
  return (
    <button
      type="button"
      aria-pressed={active}
      // aria-disabled y no `disabled`: un boton deshabilitado no recibe el foco
      // ni muestra el `title`, y el motivo es justamente lo que importa.
      aria-disabled={disabled || undefined}
      title={disabledReason}
      onClick={disabled ? undefined : onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-medium transition-colors",
        className,
        disabled
          ? "cursor-not-allowed border-dashed border-border text-muted-foreground/50"
          : active
            ? "border-primary bg-primary/10 text-foreground"
            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {kind && <AssetKindIcon kind={kind} className="h-3.5 w-3.5" />}
      {label}
      <span className={cn("tabular-nums", count === 0 ? "opacity-40" : "opacity-70")}>{count}</span>
    </button>
  );
}
