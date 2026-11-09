// @plantilla-quitar(servicios)
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, Loader2, Plus, Table2, Upload } from "lucide-react";
import {
  GROUP_BY,
  PAGE_SIZE,
  QUICK_FILTERS,
  QUICK_FILTER_LABELS,
  groupServices,
  serializeServiceFilters,
  serviceRowView,
  type GroupBy,
  type ServiceFilters,
  type ServiceListItem,
} from "@/lib/services/screens/list";
import { PageHeader } from "@/components/page-header";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { ClientesTabs } from "./clientes-tabs";
import { cn } from "@/lib/utils";
import { NewServiceDialog, type NewServiceOptions } from "./new-service-dialog";

const LIGHT_DOT: Record<string, string> = { red: "bg-bad", yellow: "bg-warn", green: "bg-good", gray: "bg-muted-foreground/40" };
const GROUP_LABELS: Record<GroupBy, string> = { none: "Sin agrupar", phase: "Fase", light: "Semáforo", owner: "Responsable" };

export function LightDot({ light, label }: { light: string; label: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", LIGHT_DOT[light] ?? LIGHT_DOT.gray)} title={label} aria-label={label} role="img" />;
}

/**
 * Clientes › Servicios (F26): tabla o tablero por fase, filtros rápidos, buscador, «Agrupar por», paginado de 50 y
 * el aviso de servicios con responsable dado de baja. Los filtros viven en la URL.
 */
export function ServicesListView({
  items,
  total,
  departed,
  filters,
  today,
  canCreate,
  canImport,
  newServiceOptions,
}: {
  items: ServiceListItem[];
  total: number;
  departed: number;
  filters: ServiceFilters;
  today: string;
  canCreate: boolean;
  canImport: boolean;
  newServiceOptions: NewServiceOptions;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const go = (patch: Partial<ServiceFilters>) => {
    const next = serializeServiceFilters({ ...filters, page: 1, ...patch });
    start(() => router.push(`/dashboard/clientes${next ? `?${next}` : ""}`));
  };
  const rows = items.map((s) => serviceRowView(s, today));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/clientes"
        tabs={<ClientesTabs active="servicios" />}
        // Pestañas + buscador + «Agrupar por» + vista + dos botones no entran a 900 px: los filtros bajan a su fila.
        filtersBreakpoint="wide"
        filters={
          <>
            <ExpandableSearch value={filters.q} onCommit={(next) => go({ q: next })} label="Buscar un cliente" placeholder="Buscar un cliente" pending={pending} />
            <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
              Agrupar por
              <select value={filters.groupBy} onChange={(e) => go({ groupBy: e.target.value as GroupBy })} className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground">
                {GROUP_BY.map((g) => (
                  <option key={g} value={g}>
                    {GROUP_LABELS[g]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex shrink-0 rounded-lg border border-border p-0.5" role="group" aria-label="Tabla o tablero">
              <button type="button" aria-pressed={filters.view === "table"} onClick={() => go({ view: "table" })} className={cn("rounded-md p-1.5", filters.view === "table" ? "bg-accent text-foreground" : "text-muted-foreground")} aria-label="Tabla">
                <Table2 className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" aria-pressed={filters.view === "board"} onClick={() => go({ view: "board" })} className={cn("rounded-md p-1.5", filters.view === "board" ? "bg-accent text-foreground" : "text-muted-foreground")} aria-label="Tablero">
                <LayoutGrid className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </>
        }
        right={
          <>
            {canImport && (
              <Link href="/dashboard/clientes/importar" aria-label="Importar servicios" className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-sm hover:bg-accent">
                <Upload className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Importar servicios</span>
              </Link>
            )}
            {canCreate && (
              <button type="button" onClick={() => setCreating(true)} aria-label="Nuevo servicio" className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">
                <Plus className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Servicio</span>
              </button>
            )}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 md:px-8">
          {departed > 0 && (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm">
              <span>
                {departed} {departed === 1 ? "servicio tiene" : "servicios tienen"} un responsable que ya no está o quedó a nombre del respaldo.
              </span>
              <button type="button" onClick={() => go({ departedOnly: true })} className="font-medium text-primary-ink hover:underline">
                Ver y reasignar
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtros rápidos">
            {QUICK_FILTERS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={filters.quick === k}
                onClick={() => go({ quick: k, departedOnly: false })}
                className={cn("rounded-full border px-3 py-1 text-xs", filters.quick === k ? "border-primary-edge bg-primary/10 text-primary-ink" : "border-border text-muted-foreground hover:text-foreground")}
              >
                {QUICK_FILTER_LABELS[k]}
              </button>
            ))}
            {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
          </div>

          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              {filters.quick === "all" && !filters.q ? "Todavía no hay servicios. Nacen solos al cobrar una variante que crea servicios, o con «+ Servicio»." : "Ningún servicio con estos filtros."}
            </p>
          ) : filters.view === "board" ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {groupServices(items, "phase").map((g) => (
                <section key={g.key} className="w-64 shrink-0 rounded-xl border border-border bg-muted/30 p-2">
                  <h3 className="px-1 pb-2 text-xs font-semibold text-muted-foreground">
                    {g.label} · {g.items.length}
                  </h3>
                  <ul className="space-y-2">
                    {g.items.map((s) => {
                      const r = serviceRowView(s, today);
                      return (
                        <li key={s.id}>
                          <Link href={r.href} className="block rounded-lg border border-border bg-card p-2.5 text-sm hover:bg-accent/40">
                            <span className="flex items-center gap-2 font-medium">
                              <LightDot light={r.light} label={r.lightLabel} />
                              <span className="truncate">{r.client}</span>
                            </span>
                            <span className="mt-1 block truncate text-xs text-muted-foreground">{r.product}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {r.day} · {r.progress}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            groupServices(items, filters.groupBy).map((g) => (
              <section key={g.key} className="space-y-1">
                {filters.groupBy !== "none" && <h3 className="text-xs font-semibold text-muted-foreground">{g.label}</h3>}
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Cliente</th>
                        <th className="px-3 py-2 font-medium">Producto · variante</th>
                        <th className="px-3 py-2 font-medium">Responsable</th>
                        <th className="px-3 py-2 font-medium">Semáforo</th>
                        <th className="px-3 py-2 font-medium">Fase</th>
                        <th className="px-3 py-2 font-medium">Día</th>
                        <th className="px-3 py-2 font-medium">Avance</th>
                        <th className="px-3 py-2 font-medium">Portal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((s) => {
                        const r = serviceRowView(s, today);
                        return (
                          <tr key={s.id} className="border-t border-border hover:bg-accent/30">
                            <td className="px-3 py-2">
                              <Link href={r.href} className="font-medium text-foreground hover:underline">
                                {r.client}
                              </Link>
                              {r.reviewChip && (
                                <Link href={r.reviewChip.href} className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary-ink">
                                  {r.reviewChip.label}
                                </Link>
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{r.product}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.owner}</td>
                            <td className="px-3 py-2">
                              <span className="flex items-center gap-2">
                                <LightDot light={r.light} label={r.lightLabel} />
                                <span className="text-xs text-muted-foreground">{r.lightReason || r.lightLabel}</span>
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{r.phase}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.day}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.progress}</td>
                            <td className="px-3 py-2 text-muted-foreground">{r.portal}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}

          {pages > 1 && (
            <nav aria-label="Páginas" className="flex items-center justify-between text-sm">
              <button type="button" disabled={filters.page <= 1} onClick={() => go({ page: filters.page - 1 })} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">
                Anterior
              </button>
              <span className="text-muted-foreground">
                Página {filters.page} de {pages} · {total} servicios
              </span>
              <button type="button" disabled={filters.page >= pages} onClick={() => go({ page: filters.page + 1 })} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">
                Siguiente
              </button>
            </nav>
          )}
        </div>
      </div>
      {creating && <NewServiceDialog options={newServiceOptions} onClose={() => setCreating(false)} />}
    </div>
  );
}
