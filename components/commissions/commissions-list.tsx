"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Filter, ListChecks, Loader2, Plus, X } from "lucide-react";
import { AdjustmentDialog } from "@/components/commissions/adjustment-dialog";
import { CommissionStatusChip, RoleChip } from "@/components/commissions/commission-chips";
import { PayoutDialog } from "@/components/commissions/payout-dialog";
import { ChipMultiSelect } from "@/components/finance/chip-multi-select";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { PageHeader } from "@/components/page-header";
import { selectAllCommissionsOfFilter } from "@/lib/actions/commissions-ui";
import type { RefundSuggestionResult } from "@/lib/commissions/action-types";
import {
  COMMISSION_GROUP_BY, COMMISSION_GROUP_BY_LABELS, COMMISSION_PILLS, COMMISSION_PILL_LABELS, countActiveCommissionFilters, serializeCommissionFilters, type CommissionFilters,
} from "@/lib/commissions/filters";
import type { CommissionListData, CommissionListRow } from "@/lib/commissions/list-load";
import {
  closeDrawerHref, drawerHref, exportHref, exportWarning, groupPageRows, isSelectableRow, notSelectableMessage, selectionState, setManySelected, toggleSelected,
  type PageGroup, type Selection,
} from "@/lib/commissions/list-view";
import { mineSummaryText, type MineSummary } from "@/lib/commissions/mine";
import { expenseCellText } from "@/lib/commissions/row-labels";
import type { RowExtras } from "@/lib/commissions/screen-load";
import { summarizeSelection } from "@/lib/commissions/selection";
import { COMMISSION_STATUSES, COMMISSION_STATUS_KEYS } from "@/lib/commissions/status";
import { formatUsd } from "@/lib/finance/format";
import { formatCivilDate } from "@/lib/finance/view";

/**
 * Finanzas > Comisiones (F59, F60, F63, F64). Todo el estado de la lista vive en la URL (`serializeCommissionFilters`):
 * copiar el link muestra lo mismo en otra pestaña. Qué filas hay, cuánto suman y qué pastillas cuentan lo decide el
 * servidor, en céntimos; acá solo se compone. Quien tiene alcance propio ve «Mis comisiones»: sin la columna de
 * persona, sin casillas y con su resumen del mes.
 *
 * La selección (para «Generar gasto») vive en el estado de este componente y sobrevive al cambio de página.
 */
export interface CommissionsListProps {
  data: CommissionListData;
  /** La columna «Pago» y «% o fijo» de las filas de esta página. */
  extras: RowExtras;
  /** Solo con alcance propio. */
  mine: MineSummary | null;
  canViewExpenses: boolean;
  canViewSales: boolean;
  /** Todo el equipo, para los diálogos de ajuste (y de liquidación). */
  members: ReadonlyArray<{ id: string; name: string }>;
  /** La ficha (`?commission=`), ya armada por el servidor. */
  drawer: ReactNode;
  /** Se pidió una comisión por la URL y no se pudo abrir. */
  drawerMissing: boolean;
  /** `?ajuste=<pago>`: las sugerencias del reembolso, o por qué no hay. */
  refund: RefundSuggestionResult | null;
  refundError: string | null;
}

const selectClass = "h-9 w-full rounded-lg border border-border bg-background px-2 text-sm";

export function CommissionsList({ data, extras, mine, canViewExpenses, canViewSales, members, drawer, drawerMissing, refund, refundError }: CommissionsListProps) {
  const { rows, total, page, pages, filters, scope, totals, pills, groups, canManage, canPayout, today } = data;
  const router = useRouter();
  const pathname = usePathname();
  const [navPending, startNav] = useTransition();
  const [selection, setSelection] = useState<Selection>(new Map());
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(!!refund);
  const [selectingAll, setSelectingAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const own = scope === "own";
  const selectionEnabled = canPayout && !own;
  const active = countActiveCommissionFilters(filters);
  const moreActive = filters.statuses.length + (filters.from || filters.to ? 1 : 0) + (filters.saleId ? 1 : 0) + (filters.contactId ? 1 : 0) + (filters.expenseId ? 1 : 0) + (filters.ruleId ? 1 : 0);
  const [panelOpen, setPanelOpen] = useState(moreActive > 0);
  const anyFilter = active > 0 || filters.groupBy !== null;
  const warning = exportWarning(total);
  const colSpan = 10 + (selectionEnabled ? 1 : 0) + (own ? 0 : 1);
  const selected = [...selection.values()];

  const pageGroups: PageGroup[] | null = filters.groupBy
    ? groupPageRows(rows, filters.groupBy, groups, { members: data.members, roles: data.roles, products: data.products })
    : null;

  function go(patch: Partial<CommissionFilters>) {
    const next: CommissionFilters = { ...filters, ...patch, page: patch.page ?? 1 };
    const qs = serializeCommissionFilters(next);
    startNav(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }
  const clear = () => startNav(() => router.push(pathname));
  const open = (id: string) => router.push(drawerHref(filters, id), { scroll: false });

  async function selectWholeFilter() {
    setNotice(null);
    setSelectingAll(true);
    const res = await selectAllCommissionsOfFilter(serializeCommissionFilters({ ...filters, page: 1, groupBy: null }));
    setSelectingAll(false);
    if (!res.ok) return setNotice(res.error);
    setSelection(new Map(res.items.map((item) => [item.id, item])));
    const left = res.total - res.selectable;
    const parts = [`Se eligieron ${res.items.length} de ${res.total} comisiones del filtro.`];
    if (left > 0) parts.push(`${left === 1 ? "Una no se puede" : `${left} no se pueden`} pagar todavía (anuladas, sin persona, retenidas o ya en un gasto).`);
    if (res.capped) parts.push("Una liquidación admite hasta 500: generá estas y volvé a elegir el resto.");
    if (res.truncated) parts.push("El filtro tiene más de 5.000 comisiones: se tomaron las más nuevas.");
    setNotice(parts.join(" "));
  }

  const headerActions = (
    <>
      {canManage && (
        <Link href="/dashboard/finanzas/comisiones/reglas" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent" aria-label="Reglas de comisión">
          <ListChecks className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Reglas</span>
        </Link>
      )}
      {canManage && (
        <button type="button" onClick={() => setAdjustOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90" aria-label="Nuevo ajuste">
          <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Ajuste</span>
        </button>
      )}
    </>
  );

  const emptyAll = !data.loadError && total === 0 && !anyFilter;
  const emptyFiltered = !data.loadError && total === 0 && anyFilter;
  const visiblePills = COMMISSION_PILLS.filter((p) => !(own && p === "sin_persona"));
  const roleOptions = [{ label: "", options: data.roles.map((r) => ({ value: r.key, label: r.name })) }];
  const memberOptions = [{ label: "", options: data.members.map((m) => ({ value: m.id, label: m.name })) }];
  const productOptions = [{ label: "", options: data.products.map((p) => ({ value: p.id, label: p.name })) }];

  const rowProps = { extras, own, selection, selectionEnabled, canViewExpenses, canViewSales };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/finanzas/comisiones"
        title={own ? "Mis comisiones" : undefined}
        tooltip={own ? "Lo que te toca cobrar por cada pago cobrado de tus ventas: cuánto es, de qué regla sale y cuándo se te paga." : undefined}
        tabs={<FinanceTabs />}
        right={headerActions}
      />

      <div className={`min-h-0 flex-1 overflow-y-auto p-4 transition-opacity md:p-6 ${navPending ? "opacity-60" : ""}`} aria-busy={navPending}>
        <div className="space-y-4">
          {drawerMissing && (
            <p role="status" className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <span>No encontramos esa comisión, o no tenés acceso a ella.</span>
              <Link href={closeDrawerHref(filters)} className="shrink-0 text-xs underline-offset-2 hover:underline">Cerrar aviso</Link>
            </p>
          )}
          {refundError && (
            <p role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              <span>{refundError}</span>
              <Link href={closeDrawerHref(filters)} className="shrink-0 text-xs underline-offset-2 hover:underline">Cerrar aviso</Link>
            </p>
          )}

          {own && mine && <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium tabular-nums">{mineSummaryText(mine)}</p>}

          <div className={`grid grid-cols-2 gap-2 ${visiblePills.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`} role="group" aria-label="Atajos">
            {visiblePills.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={filters.pill === p}
                onClick={() => go({ pill: filters.pill === p ? null : p })}
                className={`rounded-xl border p-3 text-left transition-colors ${filters.pill === p ? "border-primary bg-primary/10" : "border-border hover:bg-accent"} ${p === "anuladas" && filters.pill !== p ? "bg-zinc-500/5 text-muted-foreground" : ""}`}
              >
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className={filters.pill === p ? "font-medium text-primary" : ""}>{COMMISSION_PILL_LABELS[p]}</span>
                  <span className="rounded-full bg-muted px-1.5 text-[11px]">{pills[p].count}</span>
                </span>
                <span className={`mt-1 block text-base font-semibold tabular-nums ${p === "anuladas" ? "text-muted-foreground" : ""}`}>{formatUsd(pills[p].cents)}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!own && <ChipMultiSelect label="Persona" groups={memberOptions} selected={filters.users} labelOf={(id) => data.members.find((m) => m.id === id)?.name ?? "Otra persona"} onChange={(users) => go({ users })} />}
            <ChipMultiSelect label="Rol" groups={roleOptions} selected={filters.roles} labelOf={(k) => data.roles.find((r) => r.key === k)?.name ?? k} onChange={(roles) => go({ roles })} />
            {!own && <ChipMultiSelect label="Producto" groups={productOptions} selected={filters.products} labelOf={(id) => data.products.find((p) => p.id === id)?.name ?? "Otro producto"} onChange={(products) => go({ products })} />}
            <label className="flex items-center gap-1.5 text-sm">
              <span className="sr-only sm:not-sr-only text-muted-foreground">Mes del cobro</span>
              <input
                type="month"
                aria-label="Mes del cobro"
                className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
                value={filters.month ?? ""}
                onChange={(e) => go({ month: e.target.value || null, from: null, to: null })}
              />
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <span className="sr-only sm:not-sr-only text-muted-foreground">Agrupar por</span>
              <select aria-label="Agrupar por" className="h-9 rounded-lg border border-border bg-background px-2 text-sm" value={filters.groupBy ?? ""} onChange={(e) => go({ groupBy: (e.target.value || null) as CommissionFilters["groupBy"] })}>
                <option value="">Sin agrupar</option>
                {COMMISSION_GROUP_BY.filter((g) => !(own && (g === "persona" || g === "producto"))).map((g) => <option key={g} value={g}>{COMMISSION_GROUP_BY_LABELS[g]}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen} aria-controls="more-commission-filters" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
              <Filter className="h-4 w-4" aria-hidden /> Más filtros{moreActive > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{moreActive}</span>}
            </button>
            {anyFilter && (
              <button type="button" onClick={clear} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" aria-hidden /> Limpiar
              </button>
            )}
            <a href={exportHref(filters)} download className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
              <Download className="h-4 w-4" aria-hidden /> Exportar CSV
            </a>
          </div>
          {warning && <p role="status" className="text-[11px] text-amber-700 dark:text-amber-300">{warning}</p>}

          {(filters.saleId || filters.contactId || filters.expenseId || filters.ruleId) && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtros puestos desde otra pantalla">
              {filters.saleId && <RemovableChip label="Solo una venta" onRemove={() => go({ saleId: null })} />}
              {filters.contactId && <RemovableChip label="Solo un contacto" onRemove={() => go({ contactId: null })} />}
              {filters.expenseId && <RemovableChip label="Solo un gasto" onRemove={() => go({ expenseId: null })} />}
              {filters.ruleId && <RemovableChip label="Solo una regla" onRemove={() => go({ ruleId: null })} />}
            </div>
          )}

          {panelOpen && (
            <div id="more-commission-filters" className="space-y-3 rounded-xl border border-border bg-card p-3">
              <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                <legend className="mb-1 text-xs font-medium">Estado</legend>
                {COMMISSION_STATUS_KEYS.filter((s) => !(own && s === "sin_persona")).map((s) => (
                  <label key={s} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={filters.statuses.includes(s)} onChange={() => go({ statuses: filters.statuses.includes(s) ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s] })} />
                    {COMMISSION_STATUSES[s].label}
                  </label>
                ))}
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cobradas desde">
                  <input type="date" className={selectClass} value={filters.from ?? ""} disabled={!!filters.month} onChange={(e) => go({ from: e.target.value || null, month: null })} />
                </Field>
                <Field label="Cobradas hasta">
                  <input type="date" className={selectClass} value={filters.to ?? ""} disabled={!!filters.month} onChange={(e) => go({ to: e.target.value || null, month: null })} />
                </Field>
              </div>
              {filters.month && <p className="text-[11px] text-muted-foreground">Hay un mes elegido arriba: para usar un rango de fechas, sacá el mes.</p>}
            </div>
          )}

          {notice && <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">{notice}</p>}

          {!data.loadError && total > 0 && (
            <>
              <dl className="flex flex-wrap gap-2" aria-label="Totales de este filtro">
                {COMMISSION_STATUS_KEYS.filter((s) => totals.byStatus[s].count > 0).map((s) => (
                  <div key={s} className={`rounded-lg border border-border px-3 py-1.5 ${s === "anulada" ? "bg-zinc-500/5" : ""}`}>
                    <dt className="text-[11px] text-muted-foreground">{COMMISSION_STATUSES[s].label} · {totals.byStatus[s].count}</dt>
                    <dd className={`text-sm font-medium tabular-nums ${s === "anulada" ? "text-muted-foreground" : ""}`}>{formatUsd(totals.byStatus[s].cents)}</dd>
                  </div>
                ))}
                <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5">
                  <dt className="text-[11px] text-muted-foreground">Total sin anuladas · {totals.total.count}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{formatUsd(totals.total.cents)}</dd>
                </div>
              </dl>
              {data.truncated && <p className="text-[11px] text-muted-foreground">Hay más de 5.000 comisiones con este filtro: los totales y las páginas cuentan las 5.000 más nuevas. Acotá el filtro para ver el total exacto.</p>}
            </>
          )}

          {data.loadError ? (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm">
              <p className="text-red-700 dark:text-red-300">No pudimos cargar las comisiones.</p>
              <button type="button" onClick={() => router.refresh()} className="mt-3 h-8 rounded-lg border border-border px-3 hover:bg-accent">Reintentar</button>
            </div>
          ) : emptyAll ? (
            <div className="rounded-xl border border-border p-8 text-center text-sm">
              <p className="font-medium">{own ? "Todavía no tenés comisiones" : "Todavía no hay comisiones"}</p>
              <p className="mt-1 text-muted-foreground">
                {own
                  ? "Aparecen solas cuando se cobra un pago de una venta en la que participás."
                  : "Se generan solas cuando un pago entra a «cobrado» y hay una regla que lo cubre. Si todavía no armaste las reglas, empezá por ahí."}
              </p>
              {canManage && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Link href="/dashboard/finanzas/comisiones/reglas" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
                    <ListChecks className="h-4 w-4" aria-hidden /> Armar las reglas
                  </Link>
                </div>
              )}
            </div>
          ) : emptyFiltered ? (
            <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
              <p>Ninguna comisión coincide con estos filtros</p>
              <button type="button" onClick={clear} className="mt-3 h-8 rounded-lg border border-border px-3 text-foreground hover:bg-accent">Limpiar filtros</button>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                <table className="w-full min-w-[1080px] text-sm">
                  <caption className="sr-only">Comisiones. Tocá una fila o su fecha para ver la ficha.</caption>
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      {selectionEnabled && (
                        <th scope="col" className="w-10 px-3 py-2">
                          <TriCheckbox state={selectionState(selection, rows)} onChange={(on) => setSelection((s) => setManySelected(s, rows, on))} label="Elegir todas las de esta página" />
                        </th>
                      )}
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Cobro</th>
                      {!own && <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Persona</th>}
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Rol</th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Venta</th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Pago</th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">Base</th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">% o fijo</th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">Monto</th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Regla</th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Estado</th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Gasto</th>
                    </tr>
                  </thead>
                  {(pageGroups ?? [{ key: "", label: "", rows, count: 0, cents: 0 }]).map((g) => (
                    <tbody key={g.key} className="divide-y divide-border border-t border-border">
                      {pageGroups && (
                        <tr className="bg-muted/30">
                          <th scope="rowgroup" colSpan={colSpan} className="px-3 py-2 text-left text-xs font-semibold">
                            <span className="inline-flex items-center gap-2">
                              {selectionEnabled && (
                                <TriCheckbox state={selectionState(selection, g.rows)} onChange={(on) => setSelection((s) => setManySelected(s, g.rows, on))} label={`Elegir las de ${g.label} en esta página`} />
                              )}
                              {g.label}
                              <GroupTotals group={g} />
                            </span>
                          </th>
                        </tr>
                      )}
                      {g.rows.map((r) => (
                        <CommissionRow key={r.id} r={r} {...rowProps} onOpen={() => open(r.id)} href={drawerHref(filters, r.id)} onToggle={() => setSelection((s) => toggleSelected(s, r))} />
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>

              <div className="space-y-4 md:hidden">
                {selectionEnabled && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <TriCheckbox state={selectionState(selection, rows)} onChange={(on) => setSelection((s) => setManySelected(s, rows, on))} label="Elegir todas las de esta página" />
                    Elegir todas las de esta página
                  </label>
                )}
                {(pageGroups ?? [{ key: "", label: "", rows, count: 0, cents: 0 }]).map((g) => (
                  <section key={g.key} aria-label={g.label || undefined}>
                    {pageGroups && (
                      <h2 className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold">
                        {selectionEnabled && (
                          <TriCheckbox state={selectionState(selection, g.rows)} onChange={(on) => setSelection((s) => setManySelected(s, g.rows, on))} label={`Elegir las de ${g.label} en esta página`} />
                        )}
                        {g.label} <GroupTotals group={g} />
                      </h2>
                    )}
                    <ul className="space-y-2">
                      {g.rows.map((r) => (
                        <CommissionCard key={r.id} r={r} {...rowProps} href={drawerHref(filters, r.id)} onToggle={() => setSelection((s) => toggleSelected(s, r))} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>

              <nav className="flex items-center justify-between text-sm" aria-label="Paginación">
                <span className="text-xs text-muted-foreground">{total} {total === 1 ? "comisión" : "comisiones"}</span>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={page <= 1} onClick={() => go({ page: page - 1 })} aria-label="Página anterior" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                  <span className="text-xs">Página {page} de {pages}</span>
                  <button type="button" disabled={page >= pages} onClick={() => go({ page: page + 1 })} aria-label="Página siguiente" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-40"><ChevronRight className="h-4 w-4" aria-hidden /></button>
                </div>
              </nav>
            </>
          )}
        </div>
      </div>

      {selectionEnabled && selection.size > 0 && (
        <div role="region" aria-label="Comisiones elegidas" className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] md:px-6">
          <p aria-live="polite" className="min-w-0 text-sm font-medium">{summarizeSelection(selected)}</p>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void selectWholeFilter()} disabled={selectingAll} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-60">
              {selectingAll && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Seleccionar todo el filtro ({total})
            </button>
            <button type="button" onClick={() => { setSelection(new Map()); setNotice(null); }} className="h-9 rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground">Limpiar</button>
            <button type="button" onClick={() => setPayoutOpen(true)} className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Generar gasto</button>
          </div>
        </div>
      )}

      {drawer}

      {payoutOpen && (
        <PayoutDialog
          selection={selection}
          members={members}
          today={today}
          onClose={() => setPayoutOpen(false)}
          onDone={() => {
            setSelection(new Map());
            setNotice(null);
            router.refresh();
          }}
        />
      )}
      {adjustOpen && (
        <AdjustmentDialog members={members} roles={data.roles} onClose={() => setAdjustOpen(false)} onDone={() => router.refresh()} />
      )}
      {refund && refundOpen && (
        <AdjustmentDialog
          members={members}
          roles={data.roles}
          refund={refund}
          onClose={() => {
            setRefundOpen(false);
            router.replace(closeDrawerHref(filters), { scroll: false });
          }}
          onDone={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ── Piezas ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button type="button" onClick={onRemove} aria-label={`Quitar el filtro: ${label}`} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-muted px-2 text-xs hover:bg-accent">
      {label} <X className="h-3 w-3" aria-hidden />
    </button>
  );
}

/** Una casilla que puede estar a medias (algunas de las filas elegidas). */
function TriCheckbox({ state, onChange, label }: { state: "none" | "some" | "all"; onChange: (on: boolean) => void; label: string }) {
  return (
    <input
      ref={(el) => {
        if (el) el.indeterminate = state === "some";
      }}
      type="checkbox"
      checked={state === "all"}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      aria-checked={state === "some" ? "mixed" : state === "all"}
    />
  );
}

function GroupTotals({ group }: { group: PageGroup }) {
  return (
    <span className="font-normal text-muted-foreground">
      · {group.count} {group.count === 1 ? "comisión" : "comisiones"} · subtotal {formatUsd(group.cents)}
      {group.rows.length < group.count && <> · {group.rows.length} en esta página</>}
    </span>
  );
}

const personOf = (r: CommissionListRow, own: boolean) => (own ? null : r.userName ?? (r.userId ? "Una persona" : null));
const roleOf = (r: CommissionListRow) => (r.kind === "adjustment" && !r.roleName ? "Ajuste" : r.roleName);

function AmountText({ r }: { r: CommissionListRow }) {
  const voided = r.status.key === "anulada";
  return <span className={`tabular-nums ${r.amountCents < 0 ? "text-red-600 dark:text-red-400" : ""} ${voided ? "text-muted-foreground line-through" : "font-semibold"}`}>{formatUsd(r.amountCents)}</span>;
}

function SaleCell({ r, canViewSales }: { r: CommissionListRow; canViewSales: boolean }) {
  if (!r.saleId) return <span className="text-muted-foreground">Sin venta</span>;
  const label = r.contactName ?? "Venta";
  return (
    <span className="block min-w-0">
      {canViewSales ? <Link href={`/dashboard/ventas/${r.saleId}`} className="block truncate underline-offset-2 hover:underline">{label}</Link> : <span className="block truncate">{label}</span>}
      {(r.productName || r.variantName) && <span className="block truncate text-xs text-muted-foreground">{[r.productName, r.variantName].filter(Boolean).join(" · ")}</span>}
    </span>
  );
}

function ExpenseCell({ r, canViewExpenses }: { r: CommissionListRow; canViewExpenses: boolean }) {
  const text = expenseCellText(r.status, !!r.expense);
  if (!text || !r.expense) return <span className="text-muted-foreground">—</span>;
  return canViewExpenses ? (
    <Link href={`/dashboard/finanzas/gastos/${r.expense.expense_id}`} className="whitespace-nowrap text-primary underline-offset-2 hover:underline">{text}</Link>
  ) : (
    <span className="whitespace-nowrap">{text}</span>
  );
}

function PickBox({ r, selection, onToggle }: { r: CommissionListRow; selection: Selection; onToggle: () => void }) {
  const reason = notSelectableMessage(r.notSelectable);
  const selectable = isSelectableRow(r);
  return (
    <span title={reason ?? undefined}>
      <input
        type="checkbox"
        checked={selection.has(r.id)}
        disabled={!selectable}
        onChange={onToggle}
        aria-label={selectable ? `Elegir la comisión de ${formatUsd(r.amountCents)}` : `No se puede elegir: ${reason}`}
      />
    </span>
  );
}

interface RowShared {
  extras: RowExtras;
  own: boolean;
  selection: Selection;
  selectionEnabled: boolean;
  canViewExpenses: boolean;
  canViewSales: boolean;
}

function CommissionRow({ r, extras, own, selection, selectionEnabled, canViewExpenses, canViewSales, onOpen, onToggle, href }: RowShared & { r: CommissionListRow; onOpen: () => void; onToggle: () => void; href: string }) {
  const voided = r.status.key === "anulada";
  const extra = extras[r.id];
  return (
    <tr
      className={`cursor-pointer hover:bg-muted/30 ${voided ? "bg-zinc-500/5 text-muted-foreground" : ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,input,label")) return;
        onOpen();
      }}
    >
      {selectionEnabled && <td className="px-3 py-2"><PickBox r={r} selection={selection} onToggle={onToggle} /></td>}
      <td className="whitespace-nowrap px-3 py-2">
        <Link href={href} scroll={false} className="underline-offset-2 hover:underline" aria-label={`Abrir la ficha de la comisión del ${formatCivilDate(r.paidOn)}`}>{formatCivilDate(r.paidOn)}</Link>
      </td>
      {!own && <td className="max-w-[160px] truncate px-3 py-2">{personOf(r, own) ?? <span className="text-red-600 dark:text-red-400">Sin persona</span>}</td>}
      <td className="px-3 py-2"><RoleChip name={roleOf(r)} /></td>
      <td className="max-w-[220px] px-3 py-2"><SaleCell r={r} canViewSales={canViewSales} /></td>
      <td className="whitespace-nowrap px-3 py-2">{extra?.payment ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{r.baseCents === null ? "—" : formatUsd(r.baseCents)}</td>
      <td className="whitespace-nowrap px-3 py-2">{extra?.calc ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right"><AmountText r={r} /></td>
      <td className="max-w-[160px] truncate px-3 py-2 text-muted-foreground" title={r.ruleName ?? undefined}>{r.ruleName ?? "—"}</td>
      <td className="px-3 py-2">
        <CommissionStatusChip status={r.status} />
        {r.status.key === "retenida" && r.status.detail && <span className="mt-0.5 block text-[11px] text-muted-foreground">{r.status.detail}</span>}
      </td>
      <td className="px-3 py-2"><ExpenseCell r={r} canViewExpenses={canViewExpenses} /></td>
    </tr>
  );
}

function CommissionCard({ r, extras, own, selection, selectionEnabled, canViewExpenses, canViewSales, onToggle, href }: RowShared & { r: CommissionListRow; onToggle: () => void; href: string }) {
  const voided = r.status.key === "anulada";
  const extra = extras[r.id];
  const person = personOf(r, own);
  return (
    <li className={`rounded-xl border border-border p-3 ${voided ? "bg-zinc-500/5" : ""}`}>
      <div className="flex items-start gap-2">
        {selectionEnabled && <div className="pt-0.5"><PickBox r={r} selection={selection} onToggle={onToggle} /></div>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {!own && <span className="truncate text-sm font-medium">{person ?? <span className="text-red-600 dark:text-red-400">Sin persona</span>}</span>}
            <RoleChip name={roleOf(r)} />
          </div>
          <div className="mt-1 text-sm"><SaleCell r={r} canViewSales={canViewSales} /></div>
        </div>
        <span className="whitespace-nowrap text-sm"><AmountText r={r} /></span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {[extra?.payment && extra.payment !== "—" ? extra.payment : null, extra?.calc, r.paidOn ? `Cobro ${formatCivilDate(r.paidOn)}` : null].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <CommissionStatusChip status={r.status} />
        <span className="text-xs"><ExpenseCell r={r} canViewExpenses={canViewExpenses} /></span>
        <Link href={href} scroll={false} className="ml-auto text-xs text-primary underline-offset-2 hover:underline">Ver ficha</Link>
      </div>
    </li>
  );
}
