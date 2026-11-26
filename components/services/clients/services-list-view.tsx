// @plantilla-quitar(servicios)
"use client";

import { PersonAvatar } from "@/components/ui/person-avatar";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, KanbanSquare, Table2, Upload } from "lucide-react";
import {
  GROUP_BY,
  PAGE_SIZE,
  QUICK_FILTERS,
  QUICK_FILTER_LABELS,
  groupServices,
  serializeServiceFilters,
  serviceRowView,
  type GroupBy,
  type QuickFilter,
  type ServiceFilters,
  type ServiceListItem,
} from "@/lib/services/screens/list";
import { withRecord } from "@/lib/services/screens/record-url";
import { PageHeader } from "@/components/page-header";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { GroupMenu, PrimaryButton, QuickFilterMenu, TopbarMoreMenu, type MoreAction } from "@/components/ui/topbar-controls";
import { ViewToggle } from "@/components/ui/view-toggle";
import { rememberRecordOpener } from "@/components/services/records/record-modal";
import { ClientesTabs } from "./clientes-tabs";
import { cn } from "@/lib/utils";
import { NewServiceDialog, type NewServiceOptions } from "./new-service-dialog";
import { useSavedView } from "./use-saved-view";
import { ColumnsMenu } from "@/components/ui/data-table/columns-menu";
import { DataTable, type DataColumn } from "@/components/ui/data-table/data-table";
import { useTablePrefs } from "@/components/ui/data-table/use-table-prefs";
import { SERVICES_TABLE_KEY, serviceColumnMetas } from "@/lib/services/screens/services-columns";
import { Tip } from "@/components/ui/tooltip";

const LIGHT_DOT: Record<string, string> = { red: "bg-bad", yellow: "bg-warn", green: "bg-good", gray: "bg-disabled-foreground/40" };
const GROUP_LABELS: Record<GroupBy, string> = { none: "Sin agrupar", phase: "Fase", light: "Semáforo", owner: "Responsable" };

export function LightDot({ light, label }: { light: string; label: string }) {
  return <Tip asChild content={label}><span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", LIGHT_DOT[light] ?? LIGHT_DOT.gray)} aria-label={label} role="img" /></Tip>;
}

/**
 * Clientes › Servicios (F26, Servicios A2): tabla o tablero, filtro rapido con conteos, buscador, «Agrupar», el menu ⋯
 * (Importar, Guardar vista) y «+ Servicio», todo en la barra superior. Cada fila abre la ficha del servicio en modal.
 * Los filtros viven en la URL.
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
  counts,
  anyPortal,
  records,
}: {
  items: ServiceListItem[];
  total: number;
  departed: number;
  filters: ServiceFilters;
  today: string;
  canCreate: boolean;
  canImport: boolean;
  newServiceOptions: NewServiceOptions;
  counts: Partial<Record<QuickFilter, number>>;
  anyPortal: boolean;
  /** La ficha abierta (modal), si la URL la pide. */
  records?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveView = useSavedView("servicios");
  const go = (patch: Partial<ServiceFilters>) => {
    const next = serializeServiceFilters({ ...filters, page: 1, ...patch });
    start(() => router.push(`/dashboard/clientes${next ? `?${next}` : ""}`));
  };
  const open = (id: string) => withRecord(pathname, params?.toString() ?? "", { kind: "service", id });
  const rows = items.map((s) => serviceRowView(s, today));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const quickKeys = QUICK_FILTERS.filter((k) => anyPortal || (k !== "expiring" && k !== "reviews"));
  const more: MoreAction[] = [
    ...(canImport ? [{ key: "import", label: "Importar servicios", icon: <Upload className="h-4 w-4" aria-hidden />, href: "/dashboard/clientes/importar" }] : []),
    { key: "save", label: saved ? "Vista guardada ✓" : "Guardar vista", icon: <Bookmark className="h-4 w-4" aria-hidden />, onSelect: () => setSaved(saveView()) },
  ];
  const boardGroup: GroupBy = filters.groupBy === "none" ? "phase" : filters.groupBy;
  const columns = useMemo<DataColumn<ServiceListItem>[]>(() => {
    const view = (s: ServiceListItem) => serviceRowView(s, today);
    const render: Record<string, (s: ServiceListItem) => React.ReactNode> = {
      // La fila entera abre el servicio; el cliente es texto (docs/tablas.md).
      client: (s) => {
        const r = view(s);
        return (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground">{r.client}</span>
            {r.reviewChip && <span className="shrink-0 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-medium text-warn">{r.reviewChip.label}</span>}
          </span>
        );
      },
      product: (s) => view(s).product,
      owner: (s) => <PersonAvatar userId={s.ownerId} name={s.ownerName} role="Responsable" emptyLabel="Sin responsable" size="sm" showName />,
      light: (s) => {
        const r = view(s);
        return (
          <span className="flex min-w-0 items-center gap-2">
            <LightDot light={r.light} label={r.lightLabel} />
            <span className="truncate text-xs text-muted-foreground">{r.lightReason || r.lightLabel}</span>
          </span>
        );
      },
      phase: (s) => view(s).phase,
      day: (s) => view(s).day,
      progress: (s) => view(s).progress,
      portal: (s) => view(s).portal,
    };
    return serviceColumnMetas(anyPortal).map((m) => ({ ...m, render: render[m.key], cellClassName: m.key === "client" || m.key === "light" ? undefined : "text-muted-foreground" }));
  }, [anyPortal, today]);
  const prefs = useTablePrefs(SERVICES_TABLE_KEY, "base", columns, null);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/clientes"
        filtersBreakpoint="wide"
        tabs={<ClientesTabs active="servicios" />}
        view={
          <ViewToggle
            label="Tabla o tablero"
            value={filters.view}
            onChange={(view) => go({ view })}
            options={[
              { value: "table", label: "Tabla", icon: Table2 },
              { value: "board", label: "Tablero", icon: KanbanSquare },
            ]}
          />
        }
        quickFilter={
          <QuickFilterMenu<QuickFilter>
            value={filters.quick}
            allKey="all"
            options={quickKeys.map((k) => ({ key: k, label: QUICK_FILTER_LABELS[k], count: counts[k] }))}
            onSelect={(k) => go({ quick: k, departedOnly: false })}
          />
        }
        search={<ExpandableSearch value={filters.q} onCommit={(q) => go({ q })} label="Buscar un cliente" placeholder="Buscar un cliente…" pending={pending} />}
        group={<GroupMenu<GroupBy> value={filters.groupBy} noneKey="none" options={GROUP_BY.map((g) => ({ key: g, label: GROUP_LABELS[g] }))} onSelect={(g) => go({ groupBy: g })} />}
        more={
          <>
            {filters.view !== "board" && <ColumnsMenu state={prefs} />}
            <TopbarMoreMenu actions={more} />
          </>
        }
        primary={canCreate ? <PrimaryButton label="Nuevo servicio" text="Servicio" onClick={() => setCreating(true)} /> : undefined}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-4 p-4 md:p-6">
          {departed > 0 && (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm">
              <span>
                {departed} {departed === 1 ? "servicio tiene" : "servicios tienen"} un responsable que ya no está o quedó a nombre del respaldo.
              </span>
              <button type="button" onClick={() => go({ departedOnly: true })} className="min-h-10 font-medium text-primary-ink hover:underline md:min-h-0">
                Ver y reasignar
              </button>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              {filters.quick === "all" && !filters.q ? "Todavía no hay servicios. Nacen solos al cobrar una variante que crea servicios, o con «+ Servicio»." : "Ningún servicio con estos filtros."}
            </p>
          ) : filters.view === "board" ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {groupServices(items, boardGroup).map((g) => (
                <section key={g.key} className="w-64 shrink-0 rounded-xl border border-border bg-muted/30 p-2">
                  <h3 className="px-1 pb-2 text-xs font-semibold text-muted-foreground">
                    {g.label} · {g.items.length}
                  </h3>
                  <ul className="space-y-2">
                    {g.items.map((s) => {
                      const r = serviceRowView(s, today);
                      return (
                        <li key={s.id}>
                          <Link href={open(s.id)} scroll={false} onClick={(e) => rememberRecordOpener(e.currentTarget)} className="block rounded-lg border border-border bg-card p-2.5 text-sm hover:bg-accent/40">
                            <span className="flex items-center gap-2 font-medium">
                              <LightDot light={r.light} label={r.lightLabel} />
                              <span className="truncate">{r.client}</span>
                              {r.reviewChip && <span className="ml-auto shrink-0 rounded-full bg-warn/15 px-1.5 text-[11px] font-medium text-warn">{s.pendingReviews}</span>}
                            </span>
                            <span className="mt-1 block truncate text-xs text-muted-foreground">{r.product}</span>
                            <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="min-w-0 flex-1 truncate">
                                {r.day} · {r.progress}
                              </span>
                              <PersonAvatar userId={s.ownerId} name={s.ownerName} role="Responsable" emptyLabel="Sin responsable" size="sm" />
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
            <DataTable
              columns={columns}
              rows={filters.groupBy === "none" ? items : []}
              groups={filters.groupBy === "none" ? undefined : groupServices(items, filters.groupBy).map((g) => ({ key: g.key, label: g.label, aside: g.items.length, rows: g.items }))}
              rowKey={(s) => s.id}
              state={prefs}
              caption="Servicios"
              rowHref={(s) => open(s.id)}
              beforeRowNavigate={rememberRecordOpener}
            />
          )}

          {pages > 1 && (
            <nav aria-label="Páginas" className="flex items-center justify-between text-sm">
              <button type="button" disabled={filters.page <= 1} onClick={() => go({ page: filters.page - 1 })} className="min-h-10 rounded-lg border border-border px-3 disabled:opacity-40 md:min-h-8">
                Anterior
              </button>
              <span className="text-muted-foreground">
                Página {filters.page} de {pages} · {total} servicios
              </span>
              <button type="button" disabled={filters.page >= pages} onClick={() => go({ page: filters.page + 1 })} className="min-h-10 rounded-lg border border-border px-3 disabled:opacity-40 md:min-h-8">
                Siguiente
              </button>
            </nav>
          )}
        </div>
      </div>
      {creating && <NewServiceDialog options={newServiceOptions} onClose={() => setCreating(false)} />}
      {records}
    </div>
  );
}
