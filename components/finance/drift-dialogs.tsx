"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createDriftAdjustment, ignoreDrift } from "@/lib/actions/finance-auto";
import { SaleModal } from "@/components/sales/sale-modal";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { formatUsd } from "@/lib/finance/format";
import { driftExplanation } from "@/lib/finance/view";

/**
 * Las dos salidas de la diferencia de un automático ya pagado (GF22): crear un ajuste (un gasto nuevo con el monto de
 * la diferencia, con su signo) o ignorarla con un motivo. Ninguna toca el monto del gasto original, que ya estaba
 * pagado. Ninguna escribe hasta apretar el botón del pie; el servidor vuelve a chequear todo.
 */
interface DriftExpense {
  id: string;
  concept: string;
}

export function DriftAdjustmentDialog({ expense, driftCents, onClose }: { expense: DriftExpense; driftCents: number; onClose: () => void }) {
  const router = useRouter();
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const result = await createDriftAdjustment(expense.id, applied);
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <SaleModal
      title="Crear ajuste"
      label="Crear ajuste"
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
          <button type="button" onClick={onClose} className="ml-auto h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
          <button type="button" disabled={pending} onClick={submit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Crear ajuste
          </button>
        </>
      }
    >
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <span className="font-medium">{expense.concept}</span>
        <span className="text-muted-foreground"> · diferencia {formatUsd(driftCents)}</span>
      </p>
      <p className="text-sm">{driftExplanation(driftCents)}</p>
      <p className="text-sm text-muted-foreground">
        Se crea un gasto de ajuste por <strong className="text-foreground">{formatUsd(driftCents)}</strong>, con la misma categoría y el mismo proveedor, que apunta a este gasto. El gasto original no se toca.
        {driftCents < 0 && " Como la diferencia es negativa, el ajuste resta."}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={applied} onChange={(e) => setApplied(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span>
          <span className="font-medium">Ya se aplicó</span>
          <span className="block text-xs text-muted-foreground">Marcalo si ese monto ya se pagó o se descontó. Si no, el ajuste queda programado para hoy y lo marcás como pagado después.</span>
        </span>
      </label>
    </SaleModal>
  );
}

export function IgnoreDriftDialog({ expense, driftCents, onClose }: { expense: DriftExpense; driftCents: number; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    if (reason.trim() === "") return setError("Contá por qué la ignorás");
    start(async () => {
      const result = await ignoreDrift(expense.id, reason);
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <SaleModal
      title="Ignorar la diferencia"
      label="Ignorar la diferencia"
      onClose={onClose}
      footer={
        <>
          {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
          <button type="button" onClick={onClose} className="ml-auto h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
          <button type="button" disabled={pending} onClick={submit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Ignorar
          </button>
        </>
      }
    >
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <span className="font-medium">{expense.concept}</span>
        <span className="text-muted-foreground"> · diferencia {formatUsd(driftCents)}</span>
      </p>
      <p className="text-sm text-muted-foreground">No se crea ningún gasto y el aviso desaparece. El motivo queda en el historial.</p>
      <DialogField label="Motivo" hint={`${reason.length}/500`}>
        <textarea className={`${fieldInput} min-h-20`} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} placeholder="Ej.: es un redondeo, no vale la pena ajustarlo" />
      </DialogField>
    </SaleModal>
  );
}
