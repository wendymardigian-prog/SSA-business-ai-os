// @plantilla-quitar(servicios)
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowDownUp, KanbanSquare, Table2 } from "lucide-react";
import {
  CLIENT_GROUP,
  CLIENT_GROUP_LABELS,
  clientQuickOptions,
  groupClients,
  matchesClientQuick,
  searchClients,
  serializeClientsUrl,
  sortClients,
  type ClientGroup,
  type ClientLight,
  type ClientQuick,
  type ClientRow,
  type ClientSort,
  type ClientsUrlState,
} from "@/lib/services/screens/clients-list";
import { relativeWhen } from "@/lib/services/screens/client-record";
import { withRecord } from "@/lib/services/screens/record-url";
import { CLIENTS_TABLE_KEY, clientColumnMetas } from "@/lib/services/screens/clients-columns";
import { viewFilterString, withViewParam, type TableViewItem } from "@/lib/ui/data-table/views";
import type { TablePrefs } from "@/lib/ui/data-table/prefs";
import { PageHeader } from "@/components/page-header";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { FilterMenu, MenuGroupLabel, MenuOption } from "@/components/ui/filter-menu";
import { GroupMenu, PrimaryButton, QuickFilterMenu } from "@/components/ui/topbar-controls";
import { ViewToggle } from "@/components/ui/view-toggle";
import { ColumnsMenu } from "@/components/ui/data-table/columns-menu";
import { DataTable, type DataColumn } from "@/components/ui/data-table/data-table";
import { useTablePrefs } from "@/components/ui/data-table/use-table-prefs";
import { ViewsMenu } from "@/components/ui/data-table/views-menu";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { rememberRecordOpener } from "@/components/services/records/record-modal";
import { cn } from "@/lib/utils";
import { ClientesTabs } from "./clientes-tabs";
import { NewServiceDialog, type NewServiceOptions } from "./new-service-dialog";

const PILL: Record<ClientLight, { label: string; cls: string; num: string }> = {
  red: { label: "Rojo", cls: "bg-bad/10 text-bad", num: "bg-bad/15 text-bad" },
  yellow: { label: "Amarillo", cls: "bg-warn/10 text-warn", num: "bg-warn/15 text-warn" },
  green: { label: "Verde", cls: "bg-good/10 text-good", num: "bg-good/15 text-good" },
  gray: { label: "Gris", cls: "bg-muted text-muted-foreground", num: "bg-muted text-muted-foreground" },
  pending: { label: "Por confirmar", cls: "bg-primary/10 text-primary-ink", num: "bg-primary/15 text-primary-ink" },
  none: { label: "Sin activos", cls: "bg-muted text-muted-foreground", num: "bg-muted text-muted-foreground" },
};
const DOT: Record<ClientLight, string> = { red: "bg-bad", yellow: "bg-warn", green: "bg-good", gray: "bg-muted-foreground/40", pending: "bg-primary", none: "bg-muted-foreground/30" };
const SORT_LABELS: Record<ClientSort, string> = { light: "Semáforo", name: "Nombre", active: "Servicios activos", progress: "Avance", login: "Último ingreso", paid: "Total cobrado" };

const usd = (cents: number) => `US$${(cents / 100).toLocaleString("es-AR", { maximumFractionDigits: cents % 100 ? 2 : 0 })}`;
const STALE = 7 * 86_400_000;

export interface ClientsViewsData {
  items: TableViewItem[];
  defaultViewId: string | null;
  activeId: string | null;
  viewParam: string | null;
  activeBase: TablePrefs | null;
  userId: string;
  isAdmin: boolean;
}

/**
 * Clientes › Clientes (F27, Servicios A2): tabla (la comun, `DataTable`) o tablero, filtro rapido con conteos,
 * ordenar, buscador, «Agrupar», vistas guardadas y columnas, todo en la barra superior. Ordenar, agrupar, filtrar y
 * buscar pasan en el navegador: la URL se actualiza sin recargar. Cada fila abre la ficha del cliente en modal.
 */
export function ClientsListView({
  rows,
  truncated,
  initial,
  views,
  members,
  canCreate,
  newServiceOptions,
  records,
}: {
  rows: ClientRow[];
  truncated: boolean;
  initial: ClientsUrlState;
  views: ClientsViewsData;
  members: Array<{ id: string; name: string }>;
  canCreate: boolean;
  newServiceOptions: NewServiceOptions;
  records?: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const timeZone = useViewerTimezone();
  const [state, setState] = useState<ClientsUrlState>(initial);
  const [sort, setSort] = useState<{ key: ClientSort; dir: "asc" | "desc" }>({ key: "light", dir: "asc" });
  const [creating, setCreating] = useState(false);
  const anyPortal = rows.some((r) => r.hasPortal);
  const nowIso = useMemo(() => new Date().toISOString(), []);

  // Cambiar la vista no le pide nada al servidor: se filtra aca y la URL se actualiza para que el link se pueda compartir.
  function update(patch: Partial<ClientsUrlState>) {
    const next = { ...state, ...patch };
    setState(next);
    const keep = new URLSearchParams(params?.toString() ?? "");
    for (const k of ["modo", "f", "agrupar", "q"]) keep.delete(k);
    for (const [k, v] of new URLSearchParams(serializeClientsUrl(next))) keep.set(k, v);
    const qs = withViewParam(keep, views.viewParam).toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  const shown = useMemo(() => sortClients(searchClients(rows, state.q).filter((r) => matchesClientQuick(r, state.quick)), sort.key, sort.dir), [rows, state.q, state.quick, sort]);
  const openClient = (id: string) => withRecord(pathname, params?.toString() ?? "", { kind: "client", id });
  const boardGroup: ClientGroup = state.group === "none" ? "light" : state.group;

  function LightPill({ r }: { r: ClientRow }) {
    const p = PILL[r.light];
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", p.cls)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", DOT[r.light])} aria-hidden />
          {p.label}
        </span>
        {r.pendingReviews > 0 && (
          <span className={cn("rounded-full px-1.5 text-xs font-semibold tabular-nums", p.num)} title="Entregas por revisar" aria-label={`${r.pendingReviews} entregas por revisar`}>
            {r.pendingReviews}
          </span>
        )}
      </span>
    );
  }

  const lastLogin = (r: ClientRow) => {
    if (!r.hasPortal) return <span className="text-muted-foreground">Sin portal</span>;
    if (!r.lastLoginAt) return <span className="text-warn">{r.portalGroup === "invited" ? "Invitada, sin entrar" : "Nunca entró"}</span>;
    const stale = Date.parse(nowIso) - Date.parse(r.lastLoginAt) > STALE;
    return <span className={stale ? "text-bad" : undefined}>{relativeWhen(r.lastLoginAt, nowIso, timeZone)}</span>;
  };

  const columns = useMemo<DataColumn<ClientRow>[]>(() => {
    const render: Record<string, (r: ClientRow) => React.ReactNode> = {
      name: (r) => (
        <Link href={openClient(r.contactId)} scroll={false} onClick={(e) => rememberRecordOpener(e.currentTarget)} className="font-medium text-foreground hover:underline">
          {r.name}
        </Link>
      ),
      light: (r) => <LightPill r={r} />,
      active: (r) => <span className="text-muted-foreground">{r.activeCount} {r.activeCount === 1 ? "activo" : "activos"}</span>,
      progress: (r) =>
        r.progressPct === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="block h-full rounded-full bg-primary" style={{ width: `${r.progressPct}%` }} />
            </span>
            <span className="tabular-nums text-muted-foreground">{r.progressPct} %</span>
          </span>
        ),
      login: lastLogin,
      paid: (r) => (r.paidCents === null ? <span className="text-muted-foreground">—</span> : usd(r.paidCents)),
    };
    return clientColumnMetas(anyPortal).map((m) => ({ ...m, align: m.key === "paid" ? ("right" as const) : undefined, render: render[m.key] }));
    // Las celdas dependen de la URL actual (los links de las fichas) y del momento de la pagina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyPortal, params, nowIso, timeZone]);
  const prefs = useTablePrefs(CLIENTS_TABLE_KEY, views.activeId ?? "base", columns, views.activeBase);

  const sortMenu = (
    <FilterMenu label="Ordenar" compact active={sort.key !== "light" || sort.dir !== "asc"} icon={<ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />} menuClassName="topbar:w-[220px]">
      <MenuGroupLabel>Ordenar por</MenuGroupLabel>
      {(Object.keys(SORT_LABELS) as ClientSort[])
        .filter((k) => anyPortal || k !== "login")
        .map((k) => (
          <MenuOption key={k} checked={sort.key === k} onSelect={() => setSort({ key: k, dir: sort.key === k && sort.dir === "asc" ? "desc" : k === "name" || k === "light" ? "asc" : "desc" })} title={SORT_LABELS[k]} description={sort.key === k ? (sort.dir === "asc" ? "De menor a mayor · tocá para invertir" : "De mayor a menor · tocá para invertir") : null} />
        ))}
    </FilterMenu>
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/clientes/lista"
        filtersBreakpoint="wide"
        tabs={<ClientesTabs active="clientes" />}
        view={
          <ViewToggle
            label="Tabla o tablero"
            value={state.mode}
            onChange={(mode) => update({ mode })}
            options={[
              { value: "table", label: "Tabla", icon: Table2 },
              { value: "board", label: "Tablero", icon: KanbanSquare },
            ]}
          />
        }
        quickFilter={<QuickFilterMenu<ClientQuick> value={state.quick} allKey="all" options={clientQuickOptions(rows)} onSelect={(quick) => update({ quick })} />}
        filters={sortMenu}
        search={<ExpandableSearch value={state.q} onCommit={(q) => update({ q })} label="Buscar un cliente" placeholder="Buscar un cliente…" />}
        group={
          <GroupMenu<ClientGroup>
            value={state.group}
            noneKey="none"
            options={CLIENT_GROUP.filter((g) => anyPortal || g !== "portal").map((g) => ({ key: g, label: CLIENT_GROUP_LABELS[g] }))}
            onSelect={(group) => update({ group })}
          />
        }
        more={
          <>
            <ViewsMenu
              tableKey={CLIENTS_TABLE_KEY}
              views={views.items}
              defaultViewId={views.defaultViewId}
              activeId={views.activeId}
              userId={views.userId}
              isAdmin={views.isAdmin}
              members={members}
              state={prefs}
              currentFilters={viewFilterString(serializeClientsUrl({ ...state, q: "" }))}
            />
            {state.mode === "table" && <ColumnsMenu state={prefs} />}
          </>
        }
        primary={canCreate ? <PrimaryButton label="Nuevo servicio" text="Servicio" onClick={() => setCreating(true)} /> : undefined}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-4 p-4 md:p-6">
          {truncated && <p className="text-xs text-muted-foreground">Hay muchos servicios: la lista se arma con los 2.000 más nuevos.</p>}
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Todavía no hay clientes con servicios.</p>
          ) : shown.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Ningún cliente con estos filtros.</p>
          ) : state.mode === "board" ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {groupClients(shown, boardGroup).map((g) => (
                <section key={g.key} className="w-64 shrink-0 rounded-xl border border-border bg-muted/30 p-2">
                  <h3 className="flex justify-between px-1 pb-2 text-xs font-semibold text-muted-foreground">
                    <span>{g.label}</span>
                    <span>{g.rows.length}</span>
                  </h3>
                  <ul className="space-y-2">
                    {g.rows.map((r) => (
                      <li key={r.contactId}>
                        <Link href={openClient(r.contactId)} scroll={false} onClick={(e) => rememberRecordOpener(e.currentTarget)} className="block space-y-1 rounded-lg border border-border bg-card p-2.5 text-sm hover:bg-accent/40">
                          <span className="block truncate font-medium">{r.name}</span>
                          <LightPill r={r} />
                          <span className="block text-xs text-muted-foreground">
                            {r.activeCount} {r.activeCount === 1 ? "servicio activo" : "servicios activos"}
                            {r.progressPct !== null ? ` · ${r.progressPct} %` : ""}
                          </span>
                          {anyPortal && <span className="block text-right text-xs">{lastLogin(r)}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            groupClients(shown, state.group).map((g) => (
              <section key={g.key} className="space-y-1">
                {state.group !== "none" && (
                  <h3 className="text-xs font-semibold text-muted-foreground">
                    {g.label} · {g.rows.length}
                  </h3>
                )}
                <DataTable columns={columns} rows={g.rows} rowKey={(r) => r.contactId} state={prefs} caption={state.group === "none" ? "Clientes" : `Clientes · ${g.label}`} />
              </section>
            ))
          )}
          <p className="text-xs text-muted-foreground">Un cliente es un contacto con al menos un servicio. El semáforo es el peor de sus servicios activos; el número al lado, sus entregas por revisar.</p>
        </div>
      </div>
      {creating && <NewServiceDialog options={newServiceOptions} onClose={() => setCreating(false)} />}
      {records}
    </div>
  );
}
