"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, Search, Sparkles, Tags, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { FilterMenu, MenuOption } from "@/components/ui/filter-menu";
import { CreateFlowButton } from "@/components/create-flow-button";
import { DeleteFlowButton, ExportFlowButton, ImportFlowButton } from "@/components/flow-actions";
import { FlowDetailsDialog } from "./flow-details-dialog";
import { categoryKey } from "@/lib/flows/categories";
import {
  EMPTY_FLOW_QUERY,
  filterFlows,
  flowCounts,
  flowListQueryString,
  FLOW_ORIGIN_LABELS,
  FLOW_STATUS_LABELS,
  hasActiveFlowFilters,
  type FlowListQuery,
  type FlowListRow,
  type FlowOrigin,
} from "@/lib/flows/list";
import type { FlowStatus } from "@/lib/types/database";
import { cn } from "@/lib/utils";

const STATUS_CLASSES: Record<FlowStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  archived: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
};

function formatDate(iso: string, timeZone: string) {
  return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone });
}

/**
 * La lista de automatizaciones (auditoria de automatizaciones, oct 2026): buscador, filtros por categoría, estado y
 * origen, y cada tarjeta con su descripción, sus categorías y cómo arranca. Lo filtrado vive en la URL
 * (`?q=&estado=&origen=&categoria=`) y se escribe sin volver a pedir la página.
 */
export function FlowsList({
  rows,
  initialQuery,
  canEdit,
  hasChannels,
  timeZone,
}: {
  rows: FlowListRow[];
  initialQuery: FlowListQuery;
  canEdit: boolean;
  hasChannels: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const [query, setQueryState] = useState<FlowListQuery>(initialQuery);
  const [editing, setEditing] = useState<FlowListRow | null>(null);

  function setQuery(patch: Partial<FlowListQuery>) {
    const next = { ...query, ...patch };
    setQueryState(next);
    const qs = flowListQueryString(next);
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }

  const counts = useMemo(() => flowCounts(rows), [rows]);
  const visible = useMemo(() => filterFlows(rows, query), [rows, query]);
  const filtered = hasActiveFlowFilters(query);
  const selectedKeys = new Set(query.categories.map(categoryKey));

  function toggleCategory(name: string) {
    const key = categoryKey(name);
    setQuery({ categories: selectedKeys.has(key) ? query.categories.filter((c) => categoryKey(c) !== key) : [...query.categories, name] });
  }

  const filters = (
    <>
      <label className="relative flex h-8 shrink-0 items-center">
        <span className="sr-only">Buscar automatizaciones</span>
        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query.q}
          onChange={(e) => setQuery({ q: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query.q !== "") {
              e.preventDefault();
              setQuery({ q: "" });
            }
          }}
          placeholder="Buscar automatizaciones"
          autoComplete="off"
          className="h-8 w-[170px] rounded-lg border border-input bg-background pl-8 pr-2 text-[13px] placeholder:text-muted-foreground focus:border-primary focus:outline-none topbar:w-[210px] [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <FilterMenu
        label="Categoría"
        value={query.categories.length === 0 ? "Todas" : query.categories.length === 1 ? query.categories[0] : `${query.categories.length} elegidas`}
        active={query.categories.length > 0}
        icon={<Tags className="h-3.5 w-3.5" />}
        align="right"
        menuClassName="topbar:w-[260px]"
      >
        <MenuOption checked={query.categories.length === 0} onSelect={() => setQuery({ categories: [] })} title="Todas las categorías" trailing={rows.length} />
        {counts.categories.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">Todavía ninguna automatización tiene categorías. Se ponen en «Detalles».</p>
        ) : (
          counts.categories.map((c) => <MenuOption key={c.name} checked={selectedKeys.has(categoryKey(c.name))} onSelect={() => toggleCategory(c.name)} title={c.name} trailing={c.count} />)
        )}
      </FilterMenu>
      <FilterMenu label="Estado" value={query.status === "all" ? "Todos" : FLOW_STATUS_LABELS[query.status]} active={query.status !== "all"} align="right" menuClassName="topbar:w-[220px]">
        <MenuOption checked={query.status === "all"} onSelect={() => setQuery({ status: "all" })} title="Todos" trailing={counts.status.all} />
        {(["published", "draft", "archived"] as FlowStatus[]).map((s) => (
          <MenuOption key={s} checked={query.status === s} onSelect={() => setQuery({ status: s })} title={FLOW_STATUS_LABELS[s]} trailing={counts.status[s]} />
        ))}
      </FilterMenu>
      <FilterMenu label="Origen" value={query.origin === "all" ? "Todos" : FLOW_ORIGIN_LABELS[query.origin]} active={query.origin !== "all"} align="right" menuClassName="topbar:w-[280px]">
        <MenuOption checked={query.origin === "all"} onSelect={() => setQuery({ origin: "all" })} title="Todos los orígenes" trailing={counts.origin.all} />
        {(Object.keys(FLOW_ORIGIN_LABELS) as FlowOrigin[]).map((o) => (
          <MenuOption key={o} checked={query.origin === o} onSelect={() => setQuery({ origin: o })} title={FLOW_ORIGIN_LABELS[o]} trailing={counts.origin[o]} />
        ))}
      </FilterMenu>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/flows"
        filters={rows.length > 0 ? filters : undefined}
        right={
          canEdit ? (
            <div className="flex items-center gap-2">
              <ImportFlowButton compact />
              <Link
                href="/dashboard/flows/templates"
                aria-label="Plantillas"
                title="Plantillas"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Sparkles className="h-4 w-4" />
                <span className="hidden 2xl:inline">Plantillas</span>
              </Link>
              <CreateFlowButton />
            </div>
          ) : null
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {!hasChannels && (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card p-5 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="text-sm font-medium">Conectá un canal para empezar</p>
              {/* @plantilla-desde(formularios) */}
              <p className="text-xs text-muted-foreground">Sin Instagram o WhatsApp conectado, las automatizaciones no pueden mandar ni recibir mensajes (las de agenda, formularios y email sí funcionan).</p>
              {/* @plantilla-hasta(formularios) */}
              {/* @plantilla-sin(formularios): <p className="text-xs text-muted-foreground">Sin Instagram o WhatsApp conectado, las automatizaciones no pueden mandar ni recibir mensajes (las de agenda y email sí funcionan).</p> */}
            </div>
            <Link href="/dashboard/channels" className="rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:opacity-90">
              Conectar
            </Link>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border p-12 text-center">
            <GitBranch className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">Todavía no hay automatizaciones</h2>
            <p className="mt-2 text-sm text-muted-foreground">Creá la primera para responder sola, recordar reuniones o avisarle al equipo.</p>
            {canEdit && (
              <div className="mt-4 flex justify-center">
                <CreateFlowButton />
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mb-3 flex min-h-[26px] flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground" aria-live="polite">
              <span>{filtered ? `${visible.length} de ${rows.length} automatizaciones` : rows.length === 1 ? "1 automatización" : `${rows.length} automatizaciones`}</span>
              {query.categories.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-1 text-[12px] text-foreground">
                  {c}
                  <button type="button" onClick={() => toggleCategory(c)} aria-label={`Quitar el filtro ${c}`} className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground hover:bg-accent">
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
              {filtered && (
                <button type="button" onClick={() => setQuery(EMPTY_FLOW_QUERY)} className="font-medium text-primary hover:underline">
                  Limpiar filtros
                </button>
              )}
            </div>

            {visible.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <p className="text-sm font-medium">Ninguna automatización coincide con estos filtros.</p>
                <button type="button" onClick={() => setQuery(EMPTY_FLOW_QUERY)} className="mt-2 text-sm font-medium text-primary hover:underline">
                  Ver todas
                </button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((flow) => (
                  <div key={flow.id} className="group relative flex flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50">
                    <Link href={`/dashboard/flows/${flow.id}`} className="absolute inset-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" aria-label={`Abrir ${flow.name}`} />
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_CLASSES[flow.status])}>{FLOW_STATUS_LABELS[flow.status]}</span>
                        {flow.hasDraft && <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Cambios sin publicar</span>}
                        {flow.origin !== "manual" && <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{FLOW_ORIGIN_LABELS[flow.origin]}</span>}
                      </div>
                      {canEdit && (
                        <div className="relative z-10 flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditing(flow)}
                            className="flex h-7 items-center rounded-md border border-border bg-card px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                            title="Nombre, descripción y categorías"
                          >
                            Detalles
                          </button>
                          <ExportFlowButton flow={flow} />
                          <DeleteFlowButton flow={flow} />
                        </div>
                      )}
                    </div>
                    <h3 className="mt-2 break-words font-medium transition-colors group-hover:text-primary">{flow.name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {flow.triggerLabel} · {flow.stepCount === 1 ? "1 paso" : `${flow.stepCount} pasos`}
                    </p>
                    {flow.description ? (
                      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{flow.description}</p>
                    ) : (
                      canEdit && <p className="mt-3 text-xs italic text-muted-foreground/70">Sin descripción</p>
                    )}
                    {flow.categories.length > 0 && (
                      <div className="relative z-10 mt-3 flex flex-wrap gap-1.5">
                        {flow.categories.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => toggleCategory(c)}
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium",
                              selectedKeys.has(categoryKey(c)) ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/20",
                            )}
                            title={`Filtrar por «${c}»`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    )}
                    {flow.blockedNote && (
                      <p className="mt-3 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{flow.blockedNote}</p>
                    )}
                    <p className="mt-auto pt-4 text-xs text-muted-foreground">Actualizada el {formatDate(flow.updatedAt, timeZone)}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {editing && (
        <FlowDetailsDialog
          open
          flowId={editing.id}
          initial={{ name: editing.name, description: editing.description, categories: editing.categories }}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
