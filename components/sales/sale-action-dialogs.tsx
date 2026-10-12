"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cancelSale, cancelSubscription, rebuildPlan, type SaleActionResult } from "@/lib/actions/sales";
import { SaleModal } from "@/components/sales/sale-modal";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { formatMoney } from "@/lib/sales/format";
import { toCents } from "@/lib/sales/money";
import { buildPaymentPlan, type Frequency } from "@/lib/sales/payment-plan";

/** Cancelar la venta o dar de baja la suscripción: pide el motivo y avisa que no se puede deshacer. */
export function CancelDialog({ saleId, kind, hasCollected, onClose }: { saleId: string; kind: "sale" | "subscription"; hasCollected: boolean; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isSale = kind === "sale";

  function submit() {
    setError(null);
    start(async () => {
      const result: SaleActionResult = isSale ? await cancelSale({ saleId, reason }) : await cancelSubscription({ saleId, reason });
      if (!result.ok) return setError(result.error);
      router.refresh();
      if (result.message && hasCollected) return setMessage(result.message);
      onClose();
    });
  }

  return (
    <SaleModal
      title={isSale ? "Cancelar la venta" : "Dar de baja la suscripción"}
      label={isSale ? "Cancelar la venta" : "Dar de baja la suscripción"}
      onClose={onClose}
      footer={
        message ? (
          <button type="button" onClick={onClose} className="ml-auto h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Entendido</button>
        ) : (
          <>
            {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Volver</button>
              <button type="button" disabled={pending || !reason.trim()} onClick={submit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-50">
                {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {isSale ? "Cancelar la venta" : "Dar de baja"}
              </button>
            </div>
          </>
        )
      }
    >
      {message ? (
        <p role="status" className="text-sm">{message}</p>
      ) : (
        <>
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            {isSale
              ? "Cancelar es definitivo: la venta no vuelve a estar activa. Los pagos programados y morosos se anulan y lo ya cobrado se conserva."
              : "La suscripción pasa a «baja» y no se vuelve a activar."}
            {isSale && hasCollected && " Como hubo cobros, después registrá el reembolso si corresponde."}
          </p>
          <DialogField label="Motivo">
            <textarea className={fieldInput} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </DialogField>
        </>
      )}
    </SaleModal>
  );
}

const FREQUENCY_LABELS: Record<Frequency, string> = { weekly: "Cada semana", biweekly: "Cada 15 días", monthly: "Cada mes" };

/**
 * «Rearmar el plan»: después de un cambio de precio con cobros, repartir lo que falta cobrar en
 * cuotas nuevas. Los pagos cobrados no se tocan; los programados y morosos se anulan.
 */
export function RebuildPlanDialog({ saleId, finalAmount, paidAmount, today, onClose }: { saleId: string; finalAmount: number; paidAmount: number; today: string; onClose: () => void }) {
  const router = useRouter();
  const remaining = (toCents(finalAmount) - toCents(paidAmount)) / 100;
  const [count, setCount] = useState("1");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [firstDue, setFirstDue] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const plan = useMemo(
    () =>
      remaining > 0
        ? buildPaymentPlan({ total: remaining, financing: "installments", first: { amount: 0, paid: false, date: firstDue }, installments: Math.max(1, Math.floor(Number(count) || 1)), frequency, firstDue })
        : [],
    [remaining, count, frequency, firstDue],
  );

  function submit() {
    setError(null);
    start(async () => {
      const result = await rebuildPlan({ saleId, payments: plan.map((p) => ({ amount: p.amount, date: p.due_date as string })) });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <SaleModal
      title="Rearmar el plan de pagos"
      label="Rearmar el plan de pagos"
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
            <button type="button" disabled={pending || (remaining > 0 && plan.length === 0)} onClick={submit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Rearmar el plan
            </button>
          </div>
        </>
      }
    >
      <p className="text-sm">Precio final {formatMoney(finalAmount)} − cobrado {formatMoney(paidAmount)} = <strong>{formatMoney(remaining)}</strong> por cobrar. Los pagos programados y morosos actuales se anulan; lo cobrado queda como está.</p>
      {remaining < 0 && <p role="alert" className="text-xs text-red-700 dark:text-red-400">Ya se cobró más que el precio final: no queda nada por repartir. Registrá un reembolso por la diferencia.</p>}
      {remaining >= 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <DialogField label="Cuotas"><input type="number" min={1} max={48} className={fieldInput} value={count} onChange={(e) => setCount(e.target.value)} /></DialogField>
            <DialogField label="Frecuencia">
              <select className={fieldInput} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
              </select>
            </DialogField>
            <DialogField label="Primera cuota"><input type="date" className={fieldInput} value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></DialogField>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {plan.map((p, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-1.5"><span>Cuota {i + 1} · {p.due_date}</span><span className="tabular-nums">{formatMoney(p.amount)}</span></li>
            ))}
            {plan.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">No queda nada por cobrar: se anulan los pagos pendientes.</li>}
          </ul>
        </>
      )}
    </SaleModal>
  );
}
