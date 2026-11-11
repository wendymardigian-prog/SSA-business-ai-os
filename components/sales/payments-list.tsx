"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { FilterMenu, MenuGroupLabel } from "@/components/ui/filter-menu";
import { ColumnsMenu } from "@/components/ui/data-table/columns-menu";
import { DataTable, type DataColumn } from "@/components/ui/data-table/data-table";
import { useTablePrefs } from "@/components/ui/data-table/use-table-prefs";
import { ViewsMenu } from "@/components/ui/data-table/views-menu";
import { MarkPaidDialog, RescheduleDialog } from "@/components/sales/payment-dialogs";
import { SalesViewToggle } from "@/components/sales/sales-view-toggle";
import { DELAY_TONE_CLASSES } from "@/lib/sales/delay";
import { formatMoney } from "@/lib/shared/format";
import { PAYMENT_STATUS_LABELS, PAYMENT_STATUSES, type PaymentStatus } from "@/lib/sales/labels";
import type { PaymentMethodDef } from "@/lib/sales/payment-methods";
import {
  PAYMENT_PILLS, PAYMENT_PILL_LABELS, countActivePaymentFilters, parsePaymentsFilters, paymentsFiltersToParams,
  type PaymentListRow, type PaymentPill, type PaymentsFilters, type PaymentsTotals,
} from "@/lib/sales/payments-list";
import { paymentStatusClasses } from "@/lib/sales/status-colors";
import { PAYMENTS_COLUMN_METAS, PAYMENTS_TABLE_KEY } from "@/lib/sales/payments-columns";
import type { TablePrefs } from "@/lib/ui/data-table/prefs";
import { viewFilterString, withViewParam, type TableViewItem } from "@/lib/ui/data-table/views";

export type PaymentListRowView = PaymentListRow & { contactName: string; contactId: string | null; product: string; variant: string | null; saleDate: string };

export interface PaymentsListData {
  rows: PaymentListRowView[];
  total: number;
  page: number;
  pageSize: number;
  filters: PaymentsFilters;
  loadError: boolean;
  pills: Record<PaymentPill, number>;
  totals: PaymentsTotals;
  /** Había más filas que el tope: los totales miran las primeras. */
  totalsTruncated: boolean;
  /** No se pudieron calcular los totales. */
  totalsFailed: boolean;
  scopeAll: boolean;
  members: Array<{ id: string; name: string }>;
  enabledMethods: string[];
  methods: PaymentMethodDef[];
  today: string;
  /** Las vistas guardadas de esta persona para la tabla. */
  views: {
    items: TableViewItem[];
    defaultViewId: string | null;
    activeId: string | null;
    viewParam: string | null;
    activeBase: TablePrefs | null;
    userId: string;
    isAdmin: boolean;
  };
}

const selectClass = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

function formatDate(date: string | null): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** La pantalla de Pagos (F33). Qué se ve lo decide la base (RLS); los filtros viven en la URL. */
export function PaymentsList({ data }: { data: PaymentsListData }) {
  const { rows, total, page, pageSize, filters, totals } = data;
  const router = useRouter();
  const pathname = usePathname();
  const [action, setAction] = useState<{ kind: "paid" | "reschedule"; row: PaymentListRowView } | null>(null);
  const active = countActivePaymentFilters(filters);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const columns = useMemo<DataColumn<PaymentListRowView>[]>(() => buildColumns(setAction), []);
  const state = useTablePrefs(PAYMENTS_TABLE_KEY, data.views.activeId ?? "base", columns, data.views.activeBase);
  const basePath = data.views.viewParam ? `${pathname}?vista=${data.views.viewParam}` : pathname;

  function go(next: Partial<PaymentsFilters>) {
    const merged: PaymentsFilters = { ...filters, ...next, page: next.page ?? 1 };
    const qs = withViewParam(paymentsFiltersToParams(merged), data.views.viewParam).toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }
  const toggleStatus = (s: string) => go({ status: filters.status.includes(s) ? filters.status.filter((x) => x !== s) : [...filters.status, s], pill: null });
  const payable = action ? { id: action.row.id, amount: action.row.amount, due: action.row.dueDate } : null;
  // El estado del pago (las pastillas) tambien vive adentro de «Filtros»: cuenta para el globito.
  const menuActive = active + (filters.pill ? 1 : 0);

  // Buscar y Filtros van en la barra de arriba (nunca una barra adentro de la pagina).
  const barFilters = (
    <>
      <ExpandableSearch
        value={filters.q ?? ""}
        onCommit={(q) => go({ q: q || null })}
        label="Buscar pagos por contacto"
        placeholder="Buscar por contacto…"
      />
      <FilterMenu
        label="Filtros"
        compact
        badge={menuActive}
        active={menuActive > 0}
        icon={<SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
        menuClassName="topbar:w-[440px]"
      >
        <div className="space-y-3 px-2.5 pb-2 pt-1">
          <p className="text-xs text-muted-foreground">{data.scopeAll ? "Todos los pagos del equipo" : "Solo los pagos de tus ventas"}</p>

          <div>
            <MenuGroupLabel>Estado del pago</MenuGroupLabel>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Estado del pago">
              {PAYMENT_PILLS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="menuitemradio"
                  aria-checked={filters.pill === p}
                  onClick={() => go({ pill: filters.pill === p ? null : p, status: [] })}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filters.pill === p ? "border-primary-edge bg-primary/10 font-medium text-primary-ink" : "border-border hover:bg-accent"}`}
                >
                  {PAYMENT_PILL_LABELS[p]}
                  <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{data.pills[p]}</span>
                </button>
              ))}
            </div>
          </div>

          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1 text-xs font-medium">Estado</legend>
            {PAYMENT_STATUSES.filter((s) => s !== "refunded").map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={filters.status.includes(s)} onChange={() => toggleStatus(s)} /> {PAYMENT_STATUS_LABELS[s as PaymentStatus]}</label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Método">
              <select className={selectClass} value={filters.method ?? ""} onChange={(e) => go({ method: e.target.value || null })}>
                <option value="">Todos</option>
                {data.methods.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Vendedor">
              <select className={selectClass} value={filters.vendedorId ?? ""} onChange={(e) => go({ vendedorId: e.target.value || null })}>
                <option value="">Todos</option>
                {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Vence entre">
              <div className="flex gap-1">
                <input type="date" aria-label="Vence desde" className={selectClass} value={filters.dueFrom ?? ""} onChange={(e) => go({ dueFrom: e.target.value || null })} />
                <input type="date" aria-label="Vence hasta" className={selectClass} value={filters.dueTo ?? ""} onChange={(e) => go({ dueTo: e.target.value || null })} />
              </div>
            </Field>
            <Field label="Cobrado entre">
              <div className="flex gap-1">
                <input type="date" aria-label="Cobrado desde" className={selectClass} value={filters.paidFrom ?? ""} onChange={(e) => go({ paidFrom: e.target.value || null })} />
                <input type="date" aria-label="Cobrado hasta" className={selectClass} value={filters.paidTo ?? ""} onChange={(e) => go({ paidTo: e.target.value || null })} />
              </div>
            </Field>
            <Field label="Cobrados con atraso mayor a (días)">
              <input type="number" min={0} className={selectClass} value={filters.delayOver ?? ""} onChange={(e) => go({ delayOver: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
          </div>

          {menuActive > 0 && (
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">{menuActive === 1 ? "1 filtro activo" : `${menuActive} filtros activos`}</span>
              <button
                type="button"
                onClick={() => go({ ...parsePaymentsFilters({}), q: filters.q })}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
                Limpiar filtros
              </button>
            </div>
          )}
        </div>
      </FilterMenu>
      <ViewsMenu
        tableKey={PAYMENTS_TABLE_KEY}
        views={data.views.items}
        defaultViewId={data.views.defaultViewId}
        activeId={data.views.activeId}
        userId={data.views.userId}
        isAdmin={data.views.isAdmin}
        members={data.members}
        state={state}
        currentFilters={viewFilterString(paymentsFiltersToParams(filters))}
      />
      <ColumnsMenu state={state} />
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/ventas/pagos" left={<SalesViewToggle active="pagos" />} filters={barFilters} />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {data.loadError ? (
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm">
            <p className="text-red-700 dark:text-red-300">No se pudieron cargar los pagos.</p>
            <button type="button" onClick={() => router.refresh()} className="mt-3 h-8 rounded-lg border border-border px-3 hover:bg-accent">Reintentar</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
            <p>{active > 0 || filters.q || filters.pill ? "No hay pagos con estos filtros." : "Todavía no hay pagos: aparecen cuando cargues una venta."}</p>
            {(active > 0 || filters.q || filters.pill) && <button type="button" onClick={() => router.push(basePath)} className="mt-3 h-8 rounded-lg border border-border px-3 text-foreground hover:bg-accent">Limpiar filtros</button>}
          </div>
        ) : (
          <>
            <DataTable
              className="hidden md:block"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              state={state}
              caption="Pagos"
              totals={totalCells(totals)}
            />

            <ul className="mt-4 space-y-2 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.contactName}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.product}</p>
                    </div>
                    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${paymentStatusClasses(r.status)}`}>{r.statusLabel}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-muted-foreground">Monto</dt><dd className="font-medium tabular-nums">{formatMoney(r.amount)}</dd></div>
                    <div><dt className="text-muted-foreground">Vence</dt><dd className="font-medium">{formatDate(r.dueDate)}</dd></div>
                    <div><dt className="text-muted-foreground">Desfase</dt><dd><span className={`inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-medium ${DELAY_TONE_CLASSES[r.delay.tone]}`}>{r.delay.label}</span></dd></div>
                  </dl>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/ventas/${r.saleId}`} className="text-xs text-primary-ink underline-offset-2 hover:underline">Ver venta</Link>
                    {r.canAct.markPaid && <button type="button" className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent" onClick={() => setAction({ kind: "paid", row: r })}>Cobrar</button>}
                    {r.canAct.reschedule && <button type="button" className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent" onClick={() => setAction({ kind: "reschedule", row: r })}>Reprogramar</button>}
                  </div>
                </li>
              ))}
            </ul>

            <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginación">
              <span className="text-xs text-muted-foreground">{total} {total === 1 ? "pago" : "pagos"}</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={page <= 1} onClick={() => go({ page: page - 1 })} aria-label="Página anterior" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
                <span className="text-xs">Página {page} de {pages}</span>
                <button type="button" disabled={page >= pages} onClick={() => go({ page: page + 1 })} aria-label="Página siguiente" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-40"><ChevronRight className="h-4 w-4" aria-hidden /></button>
              </div>
            </nav>
          </>
        )}
      </div>

      {!data.loadError && rows.length > 0 && (
        <footer className="shrink-0 border-t border-border bg-card px-4 py-2.5 md:px-6" aria-label="Totales de los pagos">
          {data.totalsFailed ? (
            <p className="text-xs text-muted-foreground">No pude calcular los totales. Recargá la página para intentarlo de nuevo.</p>
          ) : (
            <>
              <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <FooterTotal label="Total cobrado" value={formatMoney(totals.paid.gross)} tone="text-emerald-700 dark:text-emerald-400" />
                <FooterTotal label="Total programado" value={formatMoney(totals.scheduled)} />
                <FooterTotal label="Total moroso" value={formatMoney(totals.overdue)} tone="text-red-700 dark:text-red-400" />
                <p className="ml-auto text-[11px] text-muted-foreground">Montos brutos de los {totals.count} {totals.count === 1 ? "pago" : "pagos"} con este filtro.</p>
              </dl>
              {data.totalsTruncated && <p className="mt-1 text-[11px] text-muted-foreground">Hay más de 20.000 pagos con este filtro: los totales cuentan los primeros 20.000. Acotá el filtro para ver el total exacto.</p>}
            </>
          )}
        </footer>
      )}

      {action?.kind === "paid" && payable && <MarkPaidDialog saleId={action.row.saleId} payment={payable} saleDate={action.row.saleDate} today={data.today} enabledMethods={data.enabledMethods} methods={data.methods} onClose={() => setAction(null)} />}
      {action?.kind === "reschedule" && payable && <RescheduleDialog payment={payable} onClose={() => setAction(null)} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

function FooterTotal({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

const LINK = "underline-offset-2 hover:underline";

/** Las celdas de cada columna. El orden, la visibilidad y los anchos no se deciden acá. */
function buildColumns(setAction: Dispatch<SetStateAction<{ kind: "paid" | "reschedule"; row: PaymentListRowView } | null>>): DataColumn<PaymentListRowView>[] {
  const money = (value: number | null) => (value === null ? "—" : formatMoney(value));
  const cells: Record<string, Pick<DataColumn<PaymentListRowView>, "render" | "align" | "cellClassName">> = {
    due: { render: (r) => formatDate(r.dueDate) },
    contact: { render: (r) => (r.contactId ? <Link href={`/dashboard/contacts/${r.contactId}`} className={`font-medium ${LINK}`}>{r.contactName}</Link> : r.contactName) },
    product: { render: (r) => <Link href={`/dashboard/ventas/${r.saleId}`} className={LINK} title="Ver la venta">{r.product}</Link> },
    variant: { render: (r) => r.variant ?? "—", cellClassName: "text-muted-foreground" },
    amount: { align: "right", render: (r) => formatMoney(r.amount) },
    status: { render: (r) => <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${paymentStatusClasses(r.status)}`}>{r.statusLabel}</span> },
    delay: { render: (r) => <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${DELAY_TONE_CLASSES[r.delay.tone]}`}>{r.delay.label}</span> },
    method: { render: (r) => r.method ?? "—" },
    paidOn: { render: (r) => formatDate(r.paidOn) },
    fee: { align: "right", render: (r) => money(r.fee) },
    net: { align: "right", render: (r) => money(r.net) },
    actions: {
      render: (r) => (
        <div className="flex justify-end gap-1 whitespace-nowrap">
          {r.canAct.markPaid && <button type="button" className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent" onClick={() => setAction({ kind: "paid", row: r })}>Cobrar</button>}
          {r.canAct.reschedule && <button type="button" className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent" onClick={() => setAction({ kind: "reschedule", row: r })}>Reprogramar</button>}
        </div>
      ),
    },
  };
  return PAYMENTS_COLUMN_METAS.map((meta) => ({ ...meta, ...cells[meta.key] }) as DataColumn<PaymentListRowView>);
}

/** El pie de la tabla: lo que suman las columnas de plata, sobre TODAS las filas del filtro. */
function totalCells(totals: PaymentsTotals) {
  return { amount: formatMoney(totals.amount), fee: formatMoney(totals.paid.fee), net: formatMoney(totals.paid.net) };
}
