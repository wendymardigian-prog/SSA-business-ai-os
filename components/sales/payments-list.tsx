"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Filter, Search, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { MarkPaidDialog, RescheduleDialog } from "@/components/sales/payment-dialogs";
import { SalesViewToggle } from "@/components/sales/sales-view-toggle";
import { DELAY_TONE_CLASSES } from "@/lib/sales/delay";
import { formatMoney } from "@/lib/sales/format";
import { PAYMENT_STATUS_LABELS, PAYMENT_STATUSES, type PaymentStatus } from "@/lib/sales/labels";
import { PAYMENT_METHODS } from "@/lib/sales/payment-methods";
import {
  PAYMENT_PILLS, PAYMENT_PILL_LABELS, countActivePaymentFilters, paymentsFiltersToParams,
  type PaymentListRow, type PaymentPill, type PaymentsFilters, type PaymentsTotals,
} from "@/lib/sales/payments-list";
import { paymentStatusClasses } from "@/lib/sales/status-colors";

export type PaymentListRowView = PaymentListRow & { contactName: string; contactId: string | null; product: string; saleDate: string };

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
  scopeAll: boolean;
  members: Array<{ id: string; name: string }>;
  enabledMethods: string[];
  today: string;
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
  const [panelOpen, setPanelOpen] = useState(countActivePaymentFilters(filters) > 0);
  const [search, setSearch] = useState(filters.q ?? "");
  const [action, setAction] = useState<{ kind: "paid" | "reschedule"; row: PaymentListRowView } | null>(null);
  const active = countActivePaymentFilters(filters);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function go(next: Partial<PaymentsFilters>) {
    const merged: PaymentsFilters = { ...filters, ...next, page: next.page ?? 1 };
    const qs = paymentsFiltersToParams(merged).toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }
  const toggleStatus = (s: string) => go({ status: filters.status.includes(s) ? filters.status.filter((x) => x !== s) : [...filters.status, s], pill: null });
  const payable = action ? { id: action.row.id, amount: action.row.amount, due: action.row.dueDate } : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/ventas/pagos" left={<SalesViewToggle active="pagos" />} />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Estado del pago">
          {PAYMENT_PILLS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={filters.pill === p}
              onClick={() => go({ pill: filters.pill === p ? null : p, status: [] })}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm ${filters.pill === p ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-accent"}`}
            >
              {PAYMENT_PILL_LABELS[p]}
              <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{data.pills[p]}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <form className="relative min-w-[200px] flex-1 sm:max-w-sm" role="search" onSubmit={(e) => { e.preventDefault(); go({ q: search.trim() || null }); }}>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por contacto" aria-label="Buscar pagos por contacto" className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-sm" />
          </form>
          <button type="button" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            <Filter className="h-4 w-4" aria-hidden /> Filtros{active > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{active}</span>}
          </button>
          {(active > 0 || filters.q || filters.pill) && (
            <button type="button" onClick={() => router.push(pathname)} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground"><X className="h-4 w-4" aria-hidden /> Limpiar</button>
          )}
          <span className="ml-auto rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{data.scopeAll ? "Todos los pagos del equipo" : "Solo los pagos de tus ventas"}</span>
        </div>

        {panelOpen && (
          <div className="mt-3 space-y-3 rounded-xl border border-border bg-card p-3">
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
              <legend className="mb-1 text-xs font-medium">Estado</legend>
              {PAYMENT_STATUSES.filter((s) => s !== "refunded").map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={filters.status.includes(s)} onChange={() => toggleStatus(s)} /> {PAYMENT_STATUS_LABELS[s as PaymentStatus]}</label>
              ))}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Método">
                <select className={selectClass} value={filters.method ?? ""} onChange={(e) => go({ method: e.target.value || null })}>
                  <option value="">Todos</option>
                  {PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
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
          </div>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3 text-center sm:grid-cols-5">
          <Total label="Pagos" value={String(totals.count)} />
          <Total label="Monto" value={formatMoney(totals.amount)} />
          <Total label="Cobrado bruto" value={formatMoney(totals.paid.gross)} />
          <Total label="Comisión" value={formatMoney(totals.paid.fee)} />
          <Total label="Cobrado neto" value={formatMoney(totals.paid.net)} tone="text-emerald-700 dark:text-emerald-400" />
        </dl>
        {data.totalsTruncated && <p className="mt-1 text-[11px] text-muted-foreground">Hay más de 5.000 pagos con este filtro: los totales cuentan los primeros 5.000. Acotá el filtro para ver el total exacto.</p>}

        {data.loadError ? (
          <div role="alert" className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm">
            <p className="text-red-700 dark:text-red-300">No se pudieron cargar los pagos.</p>
            <button type="button" onClick={() => router.refresh()} className="mt-3 h-8 rounded-lg border border-border px-3 hover:bg-accent">Reintentar</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-6 rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
            <p>{active > 0 || filters.q || filters.pill ? "No hay pagos con estos filtros." : "Todavía no hay pagos: aparecen cuando cargues una venta."}</p>
            {(active > 0 || filters.q || filters.pill) && <button type="button" onClick={() => router.push(pathname)} className="mt-3 h-8 rounded-lg border border-border px-3 text-foreground hover:bg-accent">Limpiar filtros</button>}
          </div>
        ) : (
          <>
            <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border md:block">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>{["Vence", "Contacto", "Producto", "Monto", "Estado", "Desfase", "Método", "Cobrado el", ""].map((h, i) => <th key={i} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium ${i === 3 ? "text-right" : ""}`}>{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(r.dueDate)}</td>
                      <td className="max-w-[180px] truncate px-3 py-2">{r.contactId ? <Link href={`/dashboard/contacts/${r.contactId}`} className="font-medium underline-offset-2 hover:underline">{r.contactName}</Link> : r.contactName}</td>
                      <td className="max-w-[220px] truncate px-3 py-2"><Link href={`/dashboard/ventas/${r.saleId}`} className="underline-offset-2 hover:underline" title="Ver la venta">{r.product}</Link></td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(r.amount)}</td>
                      <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${paymentStatusClasses(r.status)}`}>{r.statusLabel}</span></td>
                      <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${DELAY_TONE_CLASSES[r.delay.tone]}`}>{r.delay.label}</span></td>
                      <td className="px-3 py-2">{r.method ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(r.paidOn)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1 whitespace-nowrap">
                          {r.canAct.markPaid && <button type="button" className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent" onClick={() => setAction({ kind: "paid", row: r })}>Cobrar</button>}
                          {r.canAct.reschedule && <button type="button" className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent" onClick={() => setAction({ kind: "reschedule", row: r })}>Reprogramar</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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
                    <Link href={`/dashboard/ventas/${r.saleId}`} className="text-xs text-primary underline-offset-2 hover:underline">Ver venta</Link>
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

      {action?.kind === "paid" && payable && <MarkPaidDialog saleId={action.row.saleId} payment={payable} saleDate={action.row.saleDate} today={data.today} enabledMethods={data.enabledMethods} onClose={() => setAction(null)} />}
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

function Total({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
