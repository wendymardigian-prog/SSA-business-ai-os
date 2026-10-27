"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { markExpensePaid, revertExpensePayment, uploadExpenseReceipt, voidExpense } from "@/lib/actions/finance-expenses";
import { SaleModal } from "@/components/sales/sale-modal";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { amountToText, parseAmountText } from "@/lib/finance/expense-form";
import { formatUsd } from "@/lib/finance/format";
import { REASON_MAX } from "@/lib/finance/expense-rules";
import { isAutoOrigin } from "@/lib/finance/expense-status";
import { formatCivilDate, receiptPickError } from "@/lib/finance/view";
import { toCents } from "@/lib/shared/money";

/**
 * Los diálogos de un gasto: pagar, revertir el pago y anular. Cada uno valida acá lo evidente y el servidor vuelve
 * a validar todo con las mismas reglas (`planPayExpense`, `planRevertExpense`, `planVoidExpense`). Ninguno escribe
 * nada hasta apretar el botón del pie.
 */

export interface DialogExpense {
  id: string;
  concept: string;
  amount: unknown;
  status: string;
  origin: string;
  scheduled_date: string;
  paid_date?: string | null;
}

function Footer({ error, onClose, children }: { error: string | null; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="ml-auto flex gap-2">
        <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
        {children}
      </div>
    </>
  );
}

function Primary({ pending, disabled, onClick, children, danger }: { pending: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      disabled={pending || disabled}
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-medium disabled:opacity-50 ${danger ? "bg-red-600 text-white" : "bg-primary text-primary-foreground"}`}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {children}
    </button>
  );
}

function ExpenseSummary({ expense }: { expense: DialogExpense }) {
  return (
    <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <span className="font-medium">{expense.concept}</span>
      <span className="text-muted-foreground"> · {formatUsd(toCents(expense.amount))} · programado el {formatCivilDate(expense.scheduled_date)}</span>
    </p>
  );
}

// ── Pagar ───────────────────────────────────────────────────────────────

export function PayExpenseDialog({ expense, today, onClose }: { expense: DialogExpense; today: string; onClose: () => void }) {
  const router = useRouter();
  const locked = isAutoOrigin(expense.origin) || expense.origin === "commission_payout";
  const needsAmount = expense.status === "por_revisar";
  const [paidDate, setPaidDate] = useState(today);
  const [amountText, setAmountText] = useState(amountToText(expense.amount));
  const [error, setError] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  const parsed = parseAmountText(amountText, { allowNegative: expense.origin === "adjustment" });
  const amountCents = parsed.kind === "ok" ? parsed.cents : null;
  const amountOk = locked || (needsAmount ? amountCents !== null && amountCents > 0 : parsed.kind !== "invalid");
  const canSubmit = !!paidDate && paidDate <= today && amountOk;

  function submit() {
    setError(null);
    if (!paidDate) return setError("Elegí la fecha de pago");
    if (paidDate > today) return setError("La fecha de pago no puede ser futura");
    if (!locked) {
      if (parsed.kind === "invalid") return setError(parsed.error);
      if (needsAmount && !(amountCents && amountCents > 0)) return setError("Cargá el monto para poder pagarlo");
    }
    const chosen = file.current?.files?.[0];
    const pickError = chosen ? receiptPickError(chosen) : null;
    if (pickError) return setError(pickError);

    start(async () => {
      const result = await markExpensePaid(expense.id, { paidDate, ...(locked || amountCents === null ? {} : { amount: amountCents / 100 }) });
      if (!result.ok) return setError(result.error);
      let failed: string | null = null;
      if (chosen) {
        const fd = new FormData();
        fd.set("expenseId", expense.id);
        fd.set("file", chosen);
        const uploaded = await uploadExpenseReceipt(fd);
        if (!uploaded.ok) failed = uploaded.error;
      }
      router.refresh();
      if (failed) {
        setReceiptError(failed);
        setPaid(true);
        return;
      }
      onClose();
    });
  }

  return (
    <SaleModal
      title="Marcar como pagado"
      label="Marcar como pagado"
      onClose={onClose}
      footer={
        paid ? (
          <button type="button" onClick={onClose} className="ml-auto h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Listo</button>
        ) : (
          <Footer error={error} onClose={onClose}>
            <Primary pending={pending} disabled={!canSubmit} onClick={submit}>Marcar pagado</Primary>
          </Footer>
        )
      }
    >
      {paid ? (
        <div className="space-y-2 text-sm">
          <p role="status">El gasto quedó pagado.</p>
          {receiptError && <p role="alert" className="text-xs text-red-700 dark:text-red-400">El comprobante no se subió: {receiptError}. Podés subirlo de nuevo desde la ficha del gasto.</p>}
        </div>
      ) : (
        <>
          <ExpenseSummary expense={expense} />
          <div className="grid gap-3 sm:grid-cols-2">
            <DialogField label="Fecha de pago">
              <input type="date" className={fieldInput} value={paidDate} max={today} onChange={(e) => setPaidDate(e.target.value)} />
            </DialogField>
            <DialogField
              label="Monto (USD)"
              hint={locked ? "Este monto lo calcula el sistema: se congela al pagarlo." : needsAmount ? "Falta el monto: cargalo para pagarlo." : undefined}
            >
              <input
                className={fieldInput}
                inputMode="decimal"
                value={amountText}
                disabled={locked}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="0,00"
                aria-invalid={parsed.kind === "invalid"}
              />
            </DialogField>
          </div>
          {parsed.kind === "invalid" && !locked && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{parsed.error}</p>}
          {parsed.kind === "ok" && !locked && parsed.cents !== toCents(expense.amount) && !needsAmount && (
            <p className="text-xs text-muted-foreground" aria-live="polite">Vas a pagar {formatUsd(parsed.cents)} en lugar de {formatUsd(toCents(expense.amount))}.</p>
          )}
          <DialogField label="Comprobante (opcional)" hint="Imagen o PDF, hasta 10 MB.">
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,.heic" className="block w-full text-sm file:mr-3 file:h-8 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:text-sm" />
          </DialogField>
        </>
      )}
    </SaleModal>
  );
}

// ── Revertir y anular (piden un motivo) ─────────────────────────────────

function ReasonDialog({
  expense, title, intro, confirmLabel, danger, onClose, run,
}: {
  expense: DialogExpense;
  title: string;
  intro: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  run: (reason: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const text = reason.trim();
    if (!text) return setError("Explicá el motivo");
    setError(null);
    start(async () => {
      const result = await run(text);
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <SaleModal
      title={title}
      label={title}
      onClose={onClose}
      footer={
        <Footer error={error} onClose={onClose}>
          <Primary pending={pending} danger={danger} disabled={!reason.trim()} onClick={submit}>{confirmLabel}</Primary>
        </Footer>
      }
    >
      <ExpenseSummary expense={expense} />
      <p className="text-sm text-muted-foreground">{intro}</p>
      <DialogField label="Motivo" hint={`${reason.length}/${REASON_MAX}`}>
        <textarea className={`${fieldInput} min-h-24`} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por qué lo hacés" />
      </DialogField>
    </SaleModal>
  );
}

export function RevertExpenseDialog({ expense, onClose }: { expense: DialogExpense; onClose: () => void }) {
  return (
    <ReasonDialog
      expense={expense}
      title="Revertir el pago"
      intro="El gasto vuelve a Programado (o a Vencido si su fecha ya pasó). Queda en el historial que se pagó y se deshizo; el comprobante se conserva."
      confirmLabel="Revertir pago"
      onClose={onClose}
      run={(reason) => revertExpensePayment(expense.id, reason)}
    />
  );
}

export function VoidExpenseDialog({ expense, onClose }: { expense: DialogExpense; onClose: () => void }) {
  return (
    <ReasonDialog
      expense={expense}
      title="Anular el gasto"
      intro="Un gasto anulado no se puede editar ni volver a activar, y deja de contar en los totales. Si es de una plantilla, esa fecha no se vuelve a generar."
      confirmLabel="Anular gasto"
      danger
      onClose={onClose}
      run={(reason) => voidExpense(expense.id, reason)}
    />
  );
}
