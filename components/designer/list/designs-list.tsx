"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, Settings, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { InfoTooltip } from "@/components/ui/tooltip";
import { PAGE_META } from "@/lib/nav/page-actions";
import { FilterMenu, MenuOption } from "@/components/ui/filter-menu";
import { Notice } from "@/components/agents/fields";
import { NewDesignModal } from "@/components/designer/new/new-design-modal";
import type { ListData, ListItem } from "@/lib/designer/queries";
import { FORMATS } from "@/lib/designer/formats";
import type { DesignStyle } from "@/lib/designer/styles";
import {
  activeFilterCount,
  cardView,
  emptyState,
  formatFilterOptions,
  listFiltersToQuery,
  LIST_TABS,
  ORIGIN_FILTERS,
  ORIGIN_FILTER_LABELS,
  pageCount,
  TAB_LABELS,
  TAB_NOTES,
  withFilter,
  type BadgeTone,
  type ListFilters,
} from "@/lib/designer/screens/list";
import { cn } from "@/lib/utils";
import { LiveThumb } from "./live-thumb";

const BADGE_TONE: Record<BadgeTone, string> = {
  ok: "bg-good/15 text-good",
  off: "bg-muted text-muted-foreground",
  pur: "bg-primary/15 text-primary-ink",
  warn: "bg-warn/15 text-warn",
};

/** Lo que dice el aviso de arriba cuando la lista se pidió con filtros que no encuentran nada. */
export function DesignsList({
  data,
  filters,
  canEdit,
  canManage,
  loadError,
  timeZone,
  nowIso,
  styles,
}: {
  data: ListData;
  filters: ListFilters;
  canEdit: boolean;
  canManage: boolean;
  loadError: boolean;
  timeZone: string;
  nowIso: string;
  styles: readonly DesignStyle[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(filters.q);
  const lastQuery = useRef(filters.q);

  const hrefFor = (next: ListFilters) => {
    const qs = listFiltersToQuery(next);
    return qs ? `/dashboard/disenos?${qs}` : "/dashboard/disenos";
  };
  const go = (next: ListFilters) => startTransition(() => router.replace(hrefFor(next), { scroll: false }));

  // El buscador filtra mientras se escribe, con una espera corta para no pedirle al servidor cada letra.
  useEffect(() => {
    if (search.trim() === lastQuery.current.trim()) return;
    const timer = setTimeout(() => {
      lastQuery.current = search;
      go(withFilter(filters, { q: search }));
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia lo escrito
  }, [search]);

  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const cards = useMemo(() => data.items.map((item) => ({ item, view: cardView(item.card, { now, timeZone }) })), [data.items, now, timeZone]);
  const filtered = activeFilterCount(filters) > 0;
  const pages = pageCount(data.total);
  const tabCount = (tab: ListFilters["tab"]) => (tab === "disenos" ? data.counts.designs : data.counts.templates);
  const empty = emptyState(filters.tab, filtered);

  const tabs = (
    <div role="tablist" aria-label="Diseños y plantillas" className="flex items-center gap-1">
      {LIST_TABS.map((tab) => {
        const selected = filters.tab === tab;
        const next = withFilter(filters, { tab, format: tab === "plantillas" && filters.format === "web" ? "all" : filters.format });
        return (
          <Link
            key={tab}
            role="tab"
            aria-selected={selected}
            href={hrefFor(next)}
            replace
            scroll={false}
            className={cn("inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-medium", selected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}
          >
            {TAB_LABELS[tab]}
            <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{tabCount(tab)}</span>
          </Link>
        );
      })}
    </div>
  );

  const filterBar = (
    <>
      <label className="relative flex h-8 shrink-0 items-center">
        <span className="sr-only">Buscar</span>
        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && search !== "") {
              e.preventDefault();
              setSearch("");
            }
          }}
          placeholder="Buscar"
          autoComplete="off"
          className="h-8 w-[150px] rounded-lg border border-input bg-background pl-8 pr-2 text-[13px] placeholder:text-muted-foreground focus:border-primary-edge focus:outline-none topbar:w-[170px] [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <FilterMenu label="Formato" value={filters.format === "all" ? "Todos" : FORMATS[filters.format].label} active={filters.format !== "all"} align="right" menuClassName="topbar:w-[260px]">
        <MenuOption checked={filters.format === "all"} onSelect={() => go(withFilter(filters, { format: "all" }))} title="Todos los formatos" />
        {formatFilterOptions(filters.tab).map((key) => (
          <MenuOption key={key} checked={filters.format === key} onSelect={() => go(withFilter(filters, { format: key }))} title={FORMATS[key].label} description={FORMATS[key].description} />
        ))}
      </FilterMenu>
      <FilterMenu label="Origen" value={filters.origin === "all" ? "Todos" : ORIGIN_FILTER_LABELS[filters.origin]} active={filters.origin !== "all"} align="right" menuClassName="topbar:w-[240px]">
        {ORIGIN_FILTERS.map((origin) => (
          <MenuOption key={origin} checked={filters.origin === origin} onSelect={() => go(withFilter(filters, { origin }))} title={ORIGIN_FILTER_LABELS[origin]} />
        ))}
      </FilterMenu>
      <FilterMenu label="Mostrar" value={filters.archived ? "Archivados" : "Activos"} active={filters.archived} align="right" menuClassName="topbar:w-[200px]">
        <MenuOption checked={!filters.archived} onSelect={() => go(withFilter(filters, { archived: false }))} title="Activos" />
        <MenuOption checked={filters.archived} onSelect={() => go(withFilter(filters, { archived: true }))} title="Archivados" />
      </FilterMenu>
    </>
  );

  const clearAll = () => {
    setSearch("");
    lastQuery.current = "";
    go({ ...filters, q: "", format: "all", origin: "all", archived: false, page: 1 });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/disenos"
        // Con pestañas y filtros en la barra, el título se truncaba también en escritorio («Diseñad…»). Desde el
        // ancho de la barra completa (`topbar:`) no se encoge; en el celular se trunca como en el resto de la app.
        titleSlot={
          <>
            <h1 className="truncate text-base font-semibold topbar:shrink-0">{PAGE_META["/dashboard/disenos"].title}</h1>
            <InfoTooltip text={PAGE_META["/dashboard/disenos"].tooltip ?? ""} />
          </>
        }
        tabs={tabs}
        filters={filterBar}
        right={
          <>
            {canManage && (
              <Link href="/dashboard/disenos/ajustes" className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 text-[13px] font-medium hover:bg-accent" aria-label="Ajustes del Diseñador IA">
                <Settings className="h-4 w-4" aria-hidden />
                <span className="hidden lg:inline">Ajustes</span>
              </Link>
            )}
            {canEdit && (
              <button type="button" onClick={() => setCreating(true)} className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Nuevo</span>
                <span className="sr-only sm:hidden">Nuevo</span>
              </button>
            )}
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
          <p className="max-w-3xl border-l-2 border-primary-edge pl-3 text-xs leading-relaxed text-muted-foreground">{TAB_NOTES[filters.tab]}</p>

          {loadError && (
            <div>
              <Notice tone="error">No pudimos cargar la lista.</Notice>
              <button type="button" onClick={() => router.refresh()} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
                Reintentar
              </button>
            </div>
          )}

          {!loadError && cards.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border px-4 py-16 text-center">
              <Sparkles className="mb-4 h-12 w-12 text-muted-foreground/50" aria-hidden />
              <p className="text-lg font-medium text-foreground">{empty.title}</p>
              <p className="mb-4 mt-1 max-w-md text-sm text-muted-foreground">{empty.text}</p>
              {filtered ? (
                <button type="button" onClick={clearAll} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                  Ver todos
                </button>
              ) : (
                canEdit && (
                  <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                    <Plus className="h-4 w-4" aria-hidden /> Crear el primero
                  </button>
                )
              )}
            </div>
          ) : (
            <ul className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))] max-sm:grid-cols-1" aria-busy={pending}>
              {cards.map(({ item, view }) => (
                <li key={view.id} className="min-w-0">
                  <DesignCard item={item} view={view} data={data} />
                </li>
              ))}
            </ul>
          )}

          {pages > 1 && (
            <nav aria-label="Páginas de la lista" className="flex items-center justify-center gap-2 text-sm">
              <button type="button" disabled={filters.page <= 1} onClick={() => go({ ...filters, page: filters.page - 1 })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 hover:bg-accent disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" aria-hidden /> Anterior
              </button>
              <span className="tabular-nums text-muted-foreground">
                {filters.page} de {pages}
              </span>
              <button type="button" disabled={filters.page >= pages} onClick={() => go({ ...filters, page: filters.page + 1 })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 hover:bg-accent disabled:opacity-40">
                Siguiente <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </nav>
          )}
          {pending && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Un momento…
            </p>
          )}
        </div>
      </div>

      {creating && <NewDesignModal initialKind={filters.tab === "plantillas" ? "template" : "design"} styles={styles} onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Una tarjeta: TODA es un link real al editor (clic con la rueda, «abrir en pestaña nueva», Enter con el foco). */
function DesignCard({ item, view, data }: { item: ListItem; view: ReturnType<typeof cardView>; data: ListData }) {
  return (
    <Link
      href={view.href}
      aria-label={`Abrir ${view.name}`}
      className={cn(
        "group flex h-full min-w-0 flex-col overflow-hidden rounded-[14px] border border-border bg-card text-left transition-all",
        "hover:-translate-y-px hover:border-muted-foreground/50 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-edge",
        view.archived && "opacity-60",
      )}
    >
      <div className="relative grid h-[170px] place-items-center border-b border-border bg-muted p-3.5">
        {item.thumbDoc ? (
          <LiveThumb doc={item.thumbDoc} box={{ width: 190, height: 140 }} assetUrls={data.assetUrls} customVars={item.customVars} uploadedFonts={data.uploadedFonts} label={`Primera página de ${view.name}`} />
        ) : (
          <span className="text-xs text-muted-foreground">Sin vista previa</span>
        )}
        {view.pagesLabel && <span className="absolute bottom-2.5 right-2.5 rounded-full border border-border bg-card px-2 text-[11px] font-semibold">{view.pagesLabel}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
        <span className="line-clamp-2 text-[13px] font-semibold leading-snug [overflow-wrap:anywhere]">{view.name}</span>
        <span className="flex flex-wrap gap-1.5">
          {view.badges.map((badge) => (
            <span key={badge.label} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold", BADGE_TONE[badge.tone])}>
              {badge.label}
            </span>
          ))}
        </span>
        <span className="mt-auto pt-0.5 text-xs text-muted-foreground">{view.metaLine}</span>
      </div>
    </Link>
  );
}
