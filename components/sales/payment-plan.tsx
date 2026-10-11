"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, CreditCard, FileText, Loader2, Paperclip, Plus, RotateCcw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { getPaymentReceiptUrl, uploadPaymentReceipt } from "@/lib/actions/payments";
import { AddPaymentDialog, MarkPaidDialog, ReasonDialog, RefundDialog, RescheduleDialog } from "@/components/sales/payment-dialogs";
import { Historial } from "@/components/historial/historial";
import { DELAY_TONE_CLASSES } from "@/lib/sales/delay";
import { formatMoney } from "@/lib/sales/format";
import { PAYMENT_STATUS_LABELS } from "@/lib/sales/labels";
import { paymentRows, tableFooter, type TablePayment } from "@/lib/sales/payment-table";
import { paymentStatusClasses } from "@/lib/sales/status-colors";

function formatDate(date: string | null): string {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

type Dialog =
  | { kind: "paid"; id: string }
  | { kind: "reschedule"; id: string }
  | { kind: "uncollectible"; id: string }
  | { kind: "revert"; id: string }
  | { kind: "add" }
  | { kind: "refund" }
  | null;

/**
 * El plan de pagos de la ficha (F28): una fila por pago con su vencimiento (y el original si se
 * reprogramó), desfase, estado, método, comisión y comprobante; las acciones por fila (con
 * `payments.manage`) y el pie con precio final, cobrado neto y saldo. Cada fila se expande al historial
 * del pago.
 */
export function PaymentPlan({
  saleId,
  saleDate,
  payments,
  finalAmount,
  isSubscription,
  saleStatus,
  canManage,
  enabledMethods,
  today,
  timeZone,
  names,
}: {
  saleId: string;
  saleDate: string;
  payments: TablePayment[];
  finalAmount: number;
  isSubscription: boolean;
  saleStatus: string;
  canManage: boolean;
  enabledMethods: string[];
  today: string;
  timeZone: string;
  names: Record<string, string>;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const closed = ["cancelled", "refunded", "subscription_cancelled"].includes(saleStatus);
  const rows = paymentRows(payments, canManage && !closed);
  const footer = tableFooter(finalAmount, payments, isSubscription);
  const byId = new Map(payments.map((p) => [p.id, p]));
  const target = dialog && "id" in dialog ? byId.get(dialog.id) : null;
  const payable = target ? { id: target.id, amount: Number(target.amount), due: target.due_date } : null;

  function viewReceipt(paymentId: string) {
    setMessage(null);
    start(async () => {
      const r = await getPaymentReceiptUrl({ paymentId });
      if (!r.ok) return setMessage(r.error);
      window.open(r.url, "_blank", "noopener,noreferrer");
    });
  }

  function uploadReceipt(paymentId: string, file: File | undefined) {
    if (!file) return;
    setMessage(null);
    start(async () => {
      const fd = new FormData();
      fd.set("paymentId", paymentId);
      fd.set("file", file);
      const r = await uploadPaymentReceipt(fd);
      if (!r.ok) return setMessage(r.error);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold"><CreditCard className="h-4 w-4" aria-hidden /> Plan de pagos</h2>
        {canManage && !closed && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setDialog({ kind: "add" })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs hover:bg-accent"><Plus className="h-3.5 w-3.5" aria-hidden /> Agregar pago</button>
            {footer.paid > 0 && <button type="button" onClick={() => setDialog({ kind: "refund" })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs hover:bg-accent"><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reembolso</button>}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Esta venta no tiene pagos cargados.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>{["", "#", "Tipo", "Monto", "Vence", "Cobrado el", "Desfase", "Estado", "Método", "Comisión", ""].map((h, i) => <th key={i} scope="col" className={`px-2 py-2 font-medium ${i === 3 || i === 9 ? "text-right" : ""}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <PaymentRowView
                  key={r.id}
                  row={r}
                  expanded={open === r.id}
                  onToggle={() => setOpen(open === r.id ? null : r.id)}
                  onAction={(kind) => setDialog({ kind, id: r.id })}
                  onReceipt={(mode, file) => (mode === "view" ? viewReceipt(r.id) : uploadReceipt(r.id, file))}
                  busy={pending}
                  timeZone={timeZone}
                  names={names}
                />
              ))}
            </tbody>
            <tfoot className="bg-muted/30 text-sm">
              <tr>
                <td colSpan={3} className="px-2 py-2 font-medium">Precio final {formatMoney(footer.final)}</td>
                <td colSpan={8} className="px-2 py-2 text-right">
                  <span className="mr-4">Cobrado neto <strong className="tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(footer.paid)}</strong></span>
                  <span className={footer.balanceRed ? "font-semibold text-red-700 dark:text-red-400" : ""}>Saldo <strong className="tabular-nums">{formatMoney(footer.balance)}</strong></span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {footer.overpaidBy > 0 && !isSubscription && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">Se cobró de más: {formatMoney(footer.overpaidBy)}. Si corresponde, registrá un reembolso por la diferencia.</p>}
      {message && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{message}</p>}
      {pending && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Un momento…</p>}

      {dialog?.kind === "paid" && payable && <MarkPaidDialog saleId={saleId} payment={payable} saleDate={saleDate} today={today} enabledMethods={enabledMethods} onClose={() => setDialog(null)} />}
      {dialog?.kind === "reschedule" && payable && <RescheduleDialog payment={payable} onClose={() => setDialog(null)} />}
      {(dialog?.kind === "uncollectible" || dialog?.kind === "revert") && payable && <ReasonDialog payment={payable} kind={dialog.kind} onClose={() => setDialog(null)} />}
      {dialog?.kind === "add" && <AddPaymentDialog saleId={saleId} today={today} enabledMethods={enabledMethods} onClose={() => setDialog(null)} />}
      {dialog?.kind === "refund" && <RefundDialog saleId={saleId} netPaid={footer.paid} saleDate={saleDate} today={today} onClose={() => setDialog(null)} />}
    </section>
  );
}

function PaymentRowView({
  row, expanded, onToggle, onAction, onReceipt, busy, timeZone, names,
}: {
  row: ReturnType<typeof paymentRows>[number];
  expanded: boolean;
  onToggle: () => void;
  onAction: (kind: "paid" | "reschedule" | "uncollectible" | "revert") => void;
  onReceipt: (mode: "view" | "upload", file?: File) => void;
  busy: boolean;
  timeZone: string;
  names: Record<string, string>;
}) {
  const a = row.actions;
  const btn = "rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-50";
  return (
    <>
      <tr className={row.status === "overdue" ? "bg-red-500/5" : undefined}>
        <td className="px-1 py-2">
          <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={`Historial del pago ${row.index}`} className="rounded p-1 text-muted-foreground hover:bg-accent">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </td>
        <td className="px-2 py-2">{row.index}</td>
        <td className="px-2 py-2">{row.typeLabel}</td>
        <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.amount)}</td>
        <td className="whitespace-nowrap px-2 py-2">
          {formatDate(row.due.current)}
          {row.due.original && <span className="ml-1 text-xs text-muted-foreground">(orig. {formatDate(row.due.original)})</span>}
        </td>
        <td className="whitespace-nowrap px-2 py-2">{formatDate(row.paidOn)}</td>
        <td className="px-2 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${DELAY_TONE_CLASSES[row.delay.tone]}`}>{row.delay.label}</span></td>
        <td className="px-2 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${paymentStatusClasses(row.status)}`}>{PAYMENT_STATUS_LABELS[row.status as keyof typeof PAYMENT_STATUS_LABELS] ?? row.statusLabel}</span></td>
        <td className="px-2 py-2">{row.method ?? "—"}</td>
        <td className="px-2 py-2 text-right tabular-nums">{row.fee != null ? formatMoney(row.fee) : "—"}</td>
        <td className="px-2 py-2">
          <div className="flex flex-wrap items-center justify-end gap-1">
            {a.markPaid && <button type="button" className={btn} onClick={() => onAction("paid")}>Cobrar</button>}
            {a.reschedule && <button type="button" className={btn} onClick={() => onAction("reschedule")}>Reprogramar</button>}
            {a.uncollectible && <button type="button" className={btn} onClick={() => onAction("uncollectible")}>Incobrable</button>}
            {a.revert && <button type="button" className={btn} onClick={() => onAction("revert")}>Revertir</button>}
            {a.receipt === "view" && <button type="button" disabled={busy} className={btn} onClick={() => onReceipt("view")} aria-label="Ver comprobante"><Paperclip className="inline h-3 w-3" aria-hidden /> Comprobante</button>}
            {a.receipt === "upload" && (
              <label className={`${btn} cursor-pointer`}>
                <Upload className="inline h-3 w-3" aria-hidden /> Subir comprobante
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => { onReceipt("upload", e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={11} className="bg-muted/20 px-4 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><FileText className="h-3 w-3" aria-hidden /> Historial del pago {row.index}</p>
            <Historial entityType="payment" entityId={row.id} names={{ users: names }} timeZone={timeZone} pageSize={10} />
          </td>
        </tr>
      )}
    </>
  );
}
