"use client";

import { Plus, Trash2 } from "lucide-react";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { FINANCING_TYPE_LABELS, PAYMENT_TYPE_LABELS, type FinancingType } from "@/lib/sales/labels";
import { selectableMethods } from "@/lib/sales/payment-methods";
import type { Frequency, PlannedPayment } from "@/lib/sales/payment-plan";
import type { SaleSummary } from "@/lib/sales/wizard/summary";
import type { RowsCheck, Step3State, SubscriptionInterval } from "@/lib/sales/wizard/step3";
import { formatMoney } from "@/lib/sales/format";
import type { WizardConfig } from "./types";

function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

const FREQUENCY_LABELS: Record<Frequency, string> = { weekly: "Cada semana", biweekly: "Cada 15 días", monthly: "Cada mes" };
const INTERVAL_LABELS: Record<SubscriptionInterval, string> = { monthly: "Todos los meses", quarterly: "Cada 3 meses", yearly: "Todos los años" };

/** Paso 3: tipo de financiamiento, el primer pago, el plan editable, el cuadre y «Qué va a pasar». */
export function Step3Financing({
  config,
  finalAmount,
  state,
  onState,
  rows,
  onRows,
  summary,
  check,
}: {
  config: WizardConfig;
  finalAmount: number;
  state: Step3State;
  onState: (patch: Partial<Step3State>, regenerate?: boolean) => void;
  rows: PlannedPayment[];
  onRows: (rows: PlannedPayment[]) => void;
  summary: ReturnType<typeof import("@/lib/sales/wizard/summary").buildSummary>;
  check: RowsCheck;
}) {
  const subscription = state.financing === "subscription";
  const full = state.financing === "full";
  const methods = selectableMethods(config.enabledMethods, null, config.methods);
  const setRow = (i: number, patch: Partial<PlannedPayment>) => onRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <DialogField label="Tipo de financiamiento">
          <select className={fieldInput} value={state.financing} onChange={(e) => onState({ financing: e.target.value as FinancingType }, true)}>
            {(Object.keys(FINANCING_TYPE_LABELS) as FinancingType[]).map((f) => <option key={f} value={f}>{FINANCING_TYPE_LABELS[f]}</option>)}
          </select>
        </DialogField>
        {subscription && (
          <DialogField label="Se cobra">
            <select className={fieldInput} value={state.subscriptionInterval} onChange={(e) => onState({ subscriptionInterval: e.target.value as SubscriptionInterval })}>
              {(Object.keys(INTERVAL_LABELS) as SubscriptionInterval[]).map((i) => <option key={i} value={i}>{INTERVAL_LABELS[i]}</option>)}
            </select>
          </DialogField>
        )}
      </div>

      <section aria-label="Primer pago" className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{subscription ? "Primer ciclo" : full ? "Pago" : "Primer pago"}</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          {!full && (
            <DialogField label={subscription ? "Importe del ciclo" : "Monto"}>
              <input type="number" min={0} step="0.01" inputMode="decimal" className={fieldInput} value={state.firstAmount} onChange={(e) => onState({ firstAmount: e.target.value }, true)} />
            </DialogField>
          )}
          <DialogField label="Estado">
            <select className={fieldInput} value={state.firstPaid ? "paid" : "scheduled"} onChange={(e) => onState({ firstPaid: e.target.value === "paid" }, true)}>
              <option value="paid">Ya cobrado</option>
              <option value="scheduled">Programado</option>
            </select>
          </DialogField>
          <DialogField label={state.firstPaid ? "Fecha de cobro" : "Vencimiento"}>
            <input type="date" className={fieldInput} value={state.firstDate} onChange={(e) => onState({ firstDate: e.target.value }, true)} />
          </DialogField>
          <DialogField label="Método">
            <select className={fieldInput} value={state.firstMethod} onChange={(e) => onState({ firstMethod: e.target.value }, true)}>
              <option value="">{state.firstPaid ? "Elegí un método" : "Sin definir"}</option>
              {methods.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
          </DialogField>
        </div>
      </section>

      {!full && !subscription && (
        <section aria-label="Cuotas" className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{state.financing === "reservation_balance" ? "Saldo" : "Cuotas"}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {state.financing !== "reservation_balance" && (
              <DialogField label="Cantidad de cuotas">
                <input type="number" min={1} max={48} className={fieldInput} value={state.installments} onChange={(e) => onState({ installments: e.target.value }, true)} />
              </DialogField>
            )}
            {state.financing !== "reservation_balance" && (
              <DialogField label="Frecuencia">
                <select className={fieldInput} value={state.frequency} onChange={(e) => onState({ frequency: e.target.value as Frequency }, true)}>
                  {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
                </select>
              </DialogField>
            )}
            <DialogField label={state.financing === "reservation_balance" ? "Vence el saldo" : "Primera cuota"}>
              <input type="date" className={fieldInput} value={state.firstDue} onChange={(e) => onState({ firstDue: e.target.value }, true)} />
            </DialogField>
          </div>
        </section>
      )}

      <section aria-label="Plan de pagos" className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Plan de pagos</h3>
          <button type="button" onClick={() => onRows([...rows, { type: "installment", amount: 0, status: "scheduled", due_date: state.firstDue, paid_on: null, payment_method: null }])} className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-xs hover:bg-accent">
            <Plus className="h-3 w-3" aria-hidden /> Agregar pago
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Completá el primer pago para ver el plan.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>{["#", "Tipo", "Monto", "Estado", "Fecha", "Método", ""].map((h, i) => <th key={i} scope="col" className="px-2 py-1.5 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={i} className={check.bornOverdue.includes(i) ? "bg-amber-500/5" : undefined}>
                    <td className="px-2 py-1.5">{i + 1}</td>
                    <td className="px-2 py-1.5">{PAYMENT_TYPE_LABELS[r.type]}</td>
                    <td className="px-2 py-1.5"><input aria-label={`Monto del pago ${i + 1}`} type="number" min={0} step="0.01" inputMode="decimal" className="h-8 w-24 rounded-md border border-input bg-background px-2" value={r.amount || ""} onChange={(e) => setRow(i, { amount: Number(e.target.value) || 0 })} /></td>
                    <td className="px-2 py-1.5">
                      <select aria-label={`Estado del pago ${i + 1}`} className="h-8 rounded-md border border-input bg-background px-1" value={r.status} onChange={(e) => setRow(i, { status: e.target.value as "paid" | "scheduled", paid_on: e.target.value === "paid" ? r.due_date : null })}>
                        <option value="scheduled">Programado</option>
                        <option value="paid">Cobrado</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5"><input aria-label={`Fecha del pago ${i + 1}`} type="date" className="h-8 rounded-md border border-input bg-background px-2" value={r.due_date ?? ""} onChange={(e) => setRow(i, { due_date: e.target.value, paid_on: r.status === "paid" ? e.target.value : null })} /></td>
                    <td className="px-2 py-1.5">
                      <select aria-label={`Método del pago ${i + 1}`} className="h-8 rounded-md border border-input bg-background px-1" value={r.payment_method ?? ""} onChange={(e) => setRow(i, { payment_method: e.target.value || null })}>
                        <option value="">—</option>
                        {selectableMethods(config.enabledMethods, r.payment_method, config.methods).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" onClick={() => onRows(rows.filter((_, k) => k !== i))} aria-label={`Quitar el pago ${i + 1}`} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {check.bornOverdue.length > 0 && (
          <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
            {check.bornOverdue.length === 1 ? "Un pago ya venció" : `${check.bornOverdue.length} pagos ya vencieron`}: va a nacer moroso.
          </p>
        )}
        {check.errors.map((e) => <p key={e} role="alert" className="text-xs text-red-700 dark:text-red-400">{e}</p>)}
      </section>

      {!subscription && (
        <p aria-live="polite" className={`rounded-lg px-3 py-2 text-sm font-medium ${summary.balanced ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-700 dark:text-red-300"}`}>
          {summary.balanceLine}
          {!summary.balanced && <span className="ml-1 font-normal text-xs">(el total es {formatMoney(finalAmount)})</span>}
        </p>
      )}

      <section aria-label="Qué va a pasar" className="space-y-1.5 rounded-lg border border-border p-3 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qué va a pasar</h3>
        <ul className="list-disc space-y-1 pl-5 text-xs">
          <li>La venta queda <strong>{summary.statusLabel}</strong>.</li>
          <li>Se {summary.paymentsCount === 1 ? "crea 1 pago" : `crean ${summary.paymentsCount} pagos`}.</li>
          {summary.first && <li>El primero es de {formatMoney(summary.first.amount)} y queda {summary.first.status === "paid" ? "cobrado" : "programado"}.</li>}
          {summary.nextDue && <li>El próximo vence el {formatDay(summary.nextDue)}.</li>}
          <li>{summary.flows.length > 0 ? `Se disparan estos flujos: ${summary.flows.join(", ")}.` : "No se dispara ningún flujo."}</li>
        </ul>
      </section>
    </div>
  );
}
