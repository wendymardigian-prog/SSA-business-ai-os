"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle, ChevronLeft, ChevronRight, CreditCard, Download, Filter, Megaphone, Paperclip, Plus, Repeat, Search, SlidersHorizontal, Users, X, type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ChipMultiSelect } from "@/components/finance/chip-multi-select";
import { PayExpenseDialog } from "@/components/finance/expense-dialogs";
import { ExpenseForm } from "@/components/finance/expense-form";
import { FinanceTabs, ReadOnlyNote } from "@/components/finance/finance-tabs";
import { categoryName, findCategory, CATEGORY_GROUPS, CATEGORY_GROUP_LABELS } from "@/lib/finance/categories";
import {
  EXPENSE_PILLS, EXPENSE_PILL_LABELS, GROUP_BY_OPTIONS, DATE_FIELDS, countActiveExpenseFilters, serializeExpenseFilters, type ExpenseFilters,
} from "@/lib/finance/expense-filters";
import { dueHint, groupExpenses, type ExpenseListRow } from "@/lib/finance/expense-list";
import { EXPENSE_ORIGINS, EXPENSE_ORIGIN_LABELS, EXPENSE_STATUSES, EXPENSE_STATUS_KEYS, expenseOriginLabel } from "@/lib/finance/expense-status";
import { formatUsd } from "@/lib/finance/format";
import type { ExpenseListData } from "@/lib/finance/list-load";
import { vendorLabel } from "@/lib/finance/vendors";
import { amountClasses, categoryOptionGroups, driftNotice, exportHref, exportWarning, expenseStatusClasses, formatCivilDate } from "@/lib/finance/view";
import { toCents } from "@/lib/sales/money";

/**
 * Finanzas > Gastos. Todo el estado vive en la URL (`serializeExpenseFilters`): copiar el link muestra lo mismo en
 * otra pestaña. Qué filas hay, cuánto suman y qué pastillas cuentan lo decide el servidor; acá solo se compone.
 */

const ORIGIN_ICONS: Partial<Record<string, LucideIcon>> = {
  recurring: Repeat,
  processor_fee: CreditCard,
  meta_ads: Megaphone,
  adjustment: SlidersHorizontal,
  commission_payout: Users,
};

const selectClass = "h-9 w-full rounded-lg border border-border bg-background px-2 text-sm";
const PAYABLE = new Set(["por_revisar", "programado", "vencido"]);

export function ExpensesList({ data }: { data: ExpenseListData }) {
  const { rows, total, page, pageSize, filters, pills, totals, categories, vendors, members, canManage, today } = data;
  const router = useRouter();
  const pathname = usePathname();
  const [navPending, startNav] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [paying, setPaying] = useState<ExpenseListRow | null>(null);
  const active = countActiveExpenseFilters(filters);
  const moreActive = filters.statuses.length + filters.origins.length + (filters.group ? 1 : 0) + (filters.responsibleId ? 1 : 0) + (filters.from || filters.to ? 1 : 0);
  const [panelOpen, setPanelOpen] = useState(moreActive > 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const anyFilter = active > 0 || filters.groupBy !== null;
  const warning = exportWarning(total);

  function go(patch: Partial<ExpenseFilters>) {
    const next: ExpenseFilters = { ...filters, ...patch, page: patch.page ?? 1 };
    const qs = serializeExpenseFilters(next);
    startNav(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }
  const clear = () => startNav(() => router.push(pathname));

  const categoryGroups = [{ label: "", options: categoryOptionGroups(categories).flatMap((g) => g.options.map((o) => ({ value: o.key, label: `${g.label}: ${o.name}` }))) }];
  const vendorGroups = [{ label: "", options: vendors.map((v) => ({ value: v.id, label: vendorLabel(vendors, v.id) })) }];

  const labelOfGroup = (key: string) => (filters.groupBy === "categoria" ? categoryName(categories, key) : key === "__sin_proveedor__" ? "Sin proveedor" : vendorLabel(vendors, key));
  const groups = filters.groupBy ? groupExpenses(rows, filters.groupBy, labelOfGroup) : null;

  const addButton = canManage ? (
    <button
      type="button"
      onClick={() => setFormOpen(true)}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
      aria-label="Nuevo gasto"
    >
      <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Gasto</span>
    </button>
  ) : undefined;

  const emptyAll = !data.loadError && total === 0 && !anyFilter;
  const emptyFiltered = !data.loadError && total === 0 && anyFilter;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader route="/dashboard/finanzas/gastos" tabs={<FinanceTabs />} right={addButton} />

      <div className={`min-h-0 flex-1 overflow-y-auto p-4 transition-opacity md:p-6 ${navPending ? "opacity-60" : ""}`} aria-busy={navPending}>
        <div className="space-y-4">
          {!canManage && <ReadOnlyNote />}

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Atajos">
            {EXPENSE_PILLS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={filters.pill === p}
                onClick={() => go({ pill: filters.pill === p ? null : p })}
                className={`rounded-xl border p-3 text-left transition-colors ${filters.pill === p ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}
              >
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className={filters.pill === p ? "font-medium text-primary" : ""}>{EXPENSE_PILL_LABELS[p]}</span>
                  <span className="rounded-full bg-muted px-1.5 text-[11px]">{pills[p].count}</span>
                </span>
                <span className="mt-1 block text-base font-semibold tabular-nums">{formatUsd(pills[p].cents)}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <form
              key={filters.q}
              className="relative min-w-[200px] flex-1 sm:max-w-xs"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
                go({ q });
              }}
            >
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input name="q" defaultValue={filters.q} placeholder="Buscar por concepto" aria-label="Buscar gastos por concepto" maxLength={60} className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-sm" />
            </form>
            <ChipMultiSelect label="Categoría" groups={categoryGroups} selected={filters.categories} labelOf={(k) => categoryName(categories, k)} onChange={(categories) => go({ categories })} />
            <ChipMultiSelect label="Proveedor" groups={vendorGroups} selected={filters.vendors} labelOf={(id) => vendorLabel(vendors, id)} onChange={(vendors) => go({ vendors })} />
            <label className="flex items-center gap-1.5 text-sm">
              <span className="sr-only sm:not-sr-only text-muted-foreground">Agrupar por</span>
              <select aria-label="Agrupar por" className="h-9 rounded-lg border border-border bg-background px-2 text-sm" value={filters.groupBy ?? ""} onChange={(e) => go({ groupBy: (e.target.value || null) as ExpenseFilters["groupBy"] })}>
                <option value="">Sin agrupar</option>
                {GROUP_BY_OPTIONS.map((g) => <option key={g} value={g}>{g === "categoria" ? "Categoría" : "Proveedor"}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen} aria-controls="more-expense-filters" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
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

          {panelOpen && (
            <div id="more-expense-filters" className="space-y-3 rounded-xl border border-border bg-card p-3">
              <div className="grid gap-4 md:grid-cols-2">
                <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                  <legend className="mb-1 text-xs font-medium">Estado</legend>
                  {EXPENSE_STATUS_KEYS.map((s) => (
                    <label key={s} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={filters.statuses.includes(s)} onChange={() => go({ statuses: filters.statuses.includes(s) ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s] })} />
                      {EXPENSE_STATUSES[s].label}
                    </label>
                  ))}
                </fieldset>
                <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                  <legend className="mb-1 text-xs font-medium">Origen</legend>
                  {EXPENSE_ORIGINS.map((o) => (
                    <label key={o} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={filters.origins.includes(o)} onChange={() => go({ origins: filters.origins.includes(o) ? filters.origins.filter((x) => x !== o) : [...filters.origins, o] })} />
                      {EXPENSE_ORIGIN_LABELS[o]}
                    </label>
                  ))}
                </fieldset>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Grupo de la categoría">
                  <select className={selectClass} value={filters.group ?? ""} onChange={(e) => go({ group: (e.target.value || null) as ExpenseFilters["group"] })}>
                    <option value="">Todos</option>
                    {CATEGORY_GROUPS.map((g) => <option key={g} value={g}>{CATEGORY_GROUP_LABELS[g]}</option>)}
                  </select>
                </Field>
                <Field label="Responsable">
                  <select className={selectClass} value={filters.responsibleId ?? ""} onChange={(e) => go({ responsibleId: e.target.value || null })}>
                    <option value="">Todos</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </Field>
                <Field label="Rango sobre la fecha…">
                  <select className={selectClass} value={filters.dateField} onChange={(e) => go({ dateField: e.target.value as ExpenseFilters["dateField"] })}>
                    {DATE_FIELDS.map((f) => <option key={f} value={f}>{f === "pago" ? "de pago" : "programada"}</option>)}
                  </select>
                </Field>
                <Field label="Entre">
                  <div className="flex gap-1">
                    <input type="date" aria-label="Desde" className={selectClass} value={filters.from ?? ""} onChange={(e) => go({ from: e.target.value || null })} />
                    <input type="date" aria-label="Hasta" className={selectClass} value={filters.to ?? ""} onChange={(e) => go({ to: e.target.value || null })} />
                  </div>
                </Field>
              </div>
            </div>
          )}

          {!data.loadError && total > 0 && (
            <>
              <dl className="flex flex-wrap gap-2" aria-label="Totales de este filtro">
                {EXPENSE_STATUS_KEYS.filter((s) => totals.byStatus[s].count > 0).map((s) => (
                  <div key={s} className="rounded-lg border border-border px-3 py-1.5">
                    <dt className="text-[11px] text-muted-foreground">{EXPENSE_STATUSES[s].label} · {totals.byStatus[s].count}</dt>
                    <dd className="text-sm font-medium tabular-nums">{formatUsd(totals.byStatus[s].cents)}</dd>
                  </div>
                ))}
                <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5">
                  <dt className="text-[11px] text-muted-foreground">Total sin anulados · {totals.total.count}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{formatUsd(totals.total.cents)}</dd>
                </div>
              </dl>
              {data.totalsTruncated && <p className="text-[11px] text-muted-foreground">Hay más de 5.000 gastos con este filtro: los totales cuentan los primeros 5.000. Acotá el filtro para ver el total exacto.</p>}
            </>
          )}

          {data.loadError ? (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm">
              <p className="text-red-700 dark:text-red-300">No pudimos cargar los gastos.</p>
              <button type="button" onClick={() => router.refresh()} className="mt-3 h-8 rounded-lg border border-border px-3 hover:bg-accent">Reintentar</button>
            </div>
          ) : emptyAll ? (
            <div className="rounded-xl border border-border p-8 text-center text-sm">
              <p className="font-medium">Todavía no cargaste gastos</p>
              <p className="mt-1 text-muted-foreground">Cargá lo que pagás (facturas, suscripciones, sueldos) y acá vas a ver cuánto sale y qué vence.</p>
              {canManage && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => setFormOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
                    <Plus className="h-4 w-4" aria-hidden /> Gasto
                  </button>
                  <Link href="/dashboard/finanzas/recurrentes" className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-accent">Crear un gasto recurrente</Link>
                </div>
              )}
            </div>
          ) : emptyFiltered ? (
            <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
              <p>Ningún gasto coincide con estos filtros</p>
              <button type="button" onClick={clear} className="mt-3 h-8 rounded-lg border border-border px-3 text-foreground hover:bg-accent">Limpiar filtros</button>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                <table className="w-full min-w-[920px] text-sm">
                  <caption className="sr-only">Gastos. Tocá un gasto para ver su ficha.</caption>
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      {["Programado", "Concepto", "Proveedor", "Categoría", "Monto", "Estado", "Pagado el", ""].map((h, i) => (
                        <th key={i} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium ${i === 4 ? "text-right" : ""}`}>{h || <span className="sr-only">Acciones</span>}</th>
                      ))}
                    </tr>
                  </thead>
                  {(groups ?? [{ key: "", label: "", rows, cents: 0 }]).map((g) => (
                    <tbody key={g.key} className="divide-y divide-border border-t border-border">
                      {groups && (
                        <tr className="bg-muted/30">
                          <th scope="rowgroup" colSpan={8} className="px-3 py-2 text-left text-xs font-semibold">
                            {g.label} <span className="font-normal text-muted-foreground">· {g.rows.length} {g.rows.length === 1 ? "gasto" : "gastos"} · subtotal de esta página {formatUsd(g.cents)}</span>
                          </th>
                        </tr>
                      )}
                      {g.rows.map((r) => (
                        <ExpenseRow key={r.id} r={r} data={data} onPay={() => setPaying(r)} onOpen={() => router.push(`/dashboard/finanzas/gastos/${r.id}`)} />
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>

              <div className="space-y-4 md:hidden">
                {(groups ?? [{ key: "", label: "", rows, cents: 0 }]).map((g) => (
                  <section key={g.key} aria-label={g.label || undefined}>
                    {groups && (
                      <h2 className="mb-1 text-xs font-semibold">
                        {g.label} <span className="font-normal text-muted-foreground">· subtotal de esta página {formatUsd(g.cents)}</span>
                      </h2>
                    )}
                    <ul className="space-y-2">
                      {g.rows.map((r) => <ExpenseCard key={r.id} r={r} data={data} onPay={() => setPaying(r)} />)}
                    </ul>
                  </section>
                ))}
              </div>

              <nav className="flex items-center justify-between text-sm" aria-label="Paginación">
                <span className="text-xs text-muted-foreground">{total} {total === 1 ? "gasto" : "gastos"}</span>
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

      {formOpen && <ExpenseForm mode="create" categories={categories} vendors={vendors} members={members} today={today} onClose={() => setFormOpen(false)} />}
      {paying && <PayExpenseDialog expense={paying} today={today} onClose={() => setPaying(null)} />}
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

// ── Una fila / una tarjeta ──────────────────────────────────────────────

function CategoryChip({ data, categoryKey }: { data: ExpenseListData; categoryKey: string }) {
  const color = findCategory(data.categories, categoryKey)?.color ?? "#78716c";
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span className="truncate">{categoryName(data.categories, categoryKey)}</span>
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${expenseStatusClasses(status)}`}>{EXPENSE_STATUSES[status as keyof typeof EXPENSE_STATUSES]?.label ?? status}</span>;
}

function Amount({ r }: { r: ExpenseListRow }) {
  if (r.status === "por_revisar" && toCents(r.amount) === 0) return <span className="text-xs text-amber-700 dark:text-amber-300">A confirmar</span>;
  return <span className={`${amountClasses(r.amount)} ${r.status === "anulado" ? "line-through" : ""}`}>{formatUsd(toCents(r.amount))}</span>;
}

function ConceptCell({ r }: { r: ExpenseListRow }) {
  const Icon = ORIGIN_ICONS[r.origin];
  const drift = driftNotice(r);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {Icon && (
        <span title={expenseOriginLabel(r.origin)} className="shrink-0 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">{expenseOriginLabel(r.origin)}. </span>
        </span>
      )}
      <Link href={`/dashboard/finanzas/gastos/${r.id}`} className={`min-w-0 truncate font-medium underline-offset-2 hover:underline ${r.status === "anulado" ? "text-muted-foreground line-through" : ""}`}>
        {r.concept}
      </Link>
      {r.receipt_path && (
        <span title="Tiene comprobante" className="shrink-0 text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">Tiene comprobante</span>
        </span>
      )}
      {drift && (
        <span title={drift} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" aria-hidden /> Diferencia
          <span className="sr-only">: {drift}</span>
        </span>
      )}
    </span>
  );
}

function ExpenseRow({ r, data, onPay, onOpen }: { r: ExpenseListRow; data: ExpenseListData; onPay: () => void; onOpen: () => void }) {
  const hint = dueHint(r.scheduled_date, data.today, r.status);
  return (
    <tr
      className="cursor-pointer hover:bg-muted/30"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        onOpen();
      }}
    >
      <td className="whitespace-nowrap px-3 py-2">{formatCivilDate(r.scheduled_date)}</td>
      <td className="max-w-[280px] px-3 py-2"><ConceptCell r={r} /></td>
      <td className="max-w-[180px] truncate px-3 py-2 text-muted-foreground">{r.vendor_id ? vendorLabel(data.vendors, r.vendor_id) : "—"}</td>
      <td className="max-w-[200px] px-3 py-2"><CategoryChip data={data} categoryKey={r.category_key} /></td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums"><Amount r={r} /></td>
      <td className="px-3 py-2">
        <StatusChip status={r.status} />
        {hint && <span className={`mt-0.5 block text-[11px] ${r.status === "vencido" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{hint}</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2">{formatCivilDate(r.paid_date)}</td>
      <td className="px-3 py-2 text-right">
        {data.canManage && PAYABLE.has(r.status) && (
          <button type="button" onClick={onPay} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent" aria-label={`Pagar ${r.concept}`}>Pagar</button>
        )}
      </td>
    </tr>
  );
}

function ExpenseCard({ r, data, onPay }: { r: ExpenseListRow; data: ExpenseListData; onPay: () => void }) {
  const hint = dueHint(r.scheduled_date, data.today, r.status);
  return (
    <li className="rounded-xl border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <ConceptCell r={r} />
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.vendor_id ? vendorLabel(data.vendors, r.vendor_id) : "Sin proveedor"}</p>
        </div>
        <span className="whitespace-nowrap text-sm font-semibold tabular-nums"><Amount r={r} /></span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusChip status={r.status} />
        <span className="text-xs text-muted-foreground">{formatCivilDate(r.scheduled_date)}</span>
        {hint && <span className={`text-[11px] ${r.status === "vencido" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{hint}</span>}
        {r.paid_date && <span className="text-xs text-muted-foreground">Pagado el {formatCivilDate(r.paid_date)}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CategoryChip data={data} categoryKey={r.category_key} />
        <Link href={`/dashboard/finanzas/gastos/${r.id}`} className="ml-auto text-xs text-primary underline-offset-2 hover:underline">Ver ficha</Link>
        {data.canManage && PAYABLE.has(r.status) && (
          <button type="button" onClick={onPay} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent" aria-label={`Pagar ${r.concept}`}>Pagar</button>
        )}
      </div>
    </li>
  );
}
