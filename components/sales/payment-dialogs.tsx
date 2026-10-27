"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { addPayment, correctPaymentFee, createRefund, markPaymentPaid, markUncollectible, reschedulePayment, revertPayment, uploadPaymentReceipt, type PaymentActionResult } from "@/lib/actions/payments";
import { SaleModal } from "@/components/sales/sale-modal";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { formatMoney } from "@/lib/shared/format";
import { selectableMethods, type PaymentMethodDef } from "@/lib/sales/payment-methods";
import type { PartialOffer } from "@/lib/sales/payments-rules";

/**
 * Los diálogos de pagos de la ficha de la venta (F29 y F32): cobrar, reprogramar, marcar incobrable,
 * revertir, agregar una cuota a mano y reembolsar. Cada uno valida acá lo evidente y el servidor vuelve
 * a validar todo (las mismas reglas puras). Ninguno escribe nada hasta apretar el botón del pie.
 */

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
    <button type="button" disabled={pending || disabled} onClick={onClick} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-white disabled:opacity-50 ${danger ? "bg-red-600" : "bg-primary text-primary-foreground"}`}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {children}
    </button>
  );
}

// ── Marcar cobrado ───────────────────────────────────────────────────

export interface PayableRow {
  id: string;
  amount: number;
  due: string | null;
}

export function MarkPaidDialog({ saleId, payment, saleDate, today, enabledMethods, methods: catalog, onClose }: { saleId: string; payment: PayableRow; saleDate: string; today: string; enabledMethods: string[]; methods: PaymentMethodDef[]; onClose: () => void }) {
  const router = useRouter();
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("");
  const [amount, setAmount] = useState(String(payment.amount));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ partial: PartialOffer | null; overpaidBy: number; receiptError: string | null } | null>(null);
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const methods = selectableMethods(enabledMethods, null, catalog);
  const differs = Number(amount) !== payment.amount;

  function submit() {
    setError(null);
    start(async () => {
      const result = await markPaymentPaid({ paymentId: payment.id, amount: Number(amount), paidOn, method, notes: notes.trim() || null });
      if (!result.ok) return setError(result.error);
      let receiptError: string | null = null;
      const chosen = file.current?.files?.[0];
      if (chosen) {
        const fd = new FormData();
        fd.set("paymentId", payment.id);
        fd.set("file", chosen);
        const uploaded = await uploadPaymentReceipt(fd);
        if (!uploaded.ok) receiptError = uploaded.error;
      }
      router.refresh();
      if (result.partial || result.overpaidBy > 0 || receiptError) return setDone({ partial: result.partial, overpaidBy: result.overpaidBy, receiptError });
      onClose();
    });
  }

  function createDifference(offer: PartialOffer) {
    setError(null);
    start(async () => {
      const result = await addPayment({ saleId, amount: offer.difference, dueDate: offer.suggestedDue });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <SaleModal
      title="Marcar como cobrado"
      label="Marcar como cobrado"
      onClose={() => { router.refresh(); onClose(); }}
      footer={
        done ? (
          <button type="button" onClick={onClose} className="ml-auto h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Listo</button>
        ) : (
          <Footer error={error} onClose={onClose}>
            <Primary pending={pending} disabled={!method || !(Number(amount) > 0)} onClick={submit}>Marcar cobrado</Primary>
          </Footer>
        )
      }
    >
      {done ? (
        <div className="space-y-3 text-sm">
          <p role="status">El pago quedó cobrado.</p>
          {done.overpaidBy > 0 && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">Cobraste {formatMoney(done.overpaidBy)} de más. Si corresponde, registrá un reembolso por la diferencia.</p>}
          {done.receiptError && <p role="alert" className="text-xs text-red-700 dark:text-red-400">El pago se cobró, pero el comprobante no se subió: {done.receiptError}</p>}
          {done.partial && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p>Entró menos de lo programado: faltan <strong>{formatMoney(done.partial.difference)}</strong>.</p>
              <p className="text-xs text-muted-foreground">¿Querés crear una cuota por la diferencia? Vence el {done.partial.suggestedDue}. No se crea sola.</p>
              <Primary pending={pending} onClick={() => createDifference(done.partial!)}>Crear la cuota</Primary>
              {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm">Programado: <strong>{formatMoney(payment.amount)}</strong>{payment.due ? ` · vence el ${payment.due}` : ""}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <DialogField label="Fecha del cobro"><input type="date" className={fieldInput} value={paidOn} min={saleDate} max={today} onChange={(e) => setPaidOn(e.target.value)} /></DialogField>
            <DialogField label="Método">
              <select className={fieldInput} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Elegí un método</option>
                {methods.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
              </select>
            </DialogField>
            <DialogField label="Monto cobrado" hint={differs ? "Es distinto del programado: si es menor te ofrecemos una cuota por la diferencia." : undefined}>
              <input type="number" min={0} step="0.01" inputMode="decimal" className={fieldInput} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </DialogField>
            <DialogField label="Comprobante (opcional)" hint="Imagen o PDF, hasta 10 MB.">
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="block w-full text-xs file:mr-2 file:rounded-lg file:border file:border-border file:bg-background file:px-2 file:py-1.5" />
            </DialogField>
          </div>
          <DialogField label="Nota (opcional)"><input className={fieldInput} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></DialogField>
        </>
      )}
    </SaleModal>
  );
}

// ── Reprogramar ──────────────────────────────────────────────────────

export function RescheduleDialog({ payment, onClose }: { payment: PayableRow; onClose: () => void }) {
  const router = useRouter();
  const [date, setDate] = useState(payment.due ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const result: PaymentActionResult = await reschedulePayment({ paymentId: payment.id, newDate: date, reason });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <SaleModal title="Reprogramar el pago" label="Reprogramar el pago" onClose={onClose} footer={<Footer error={error} onClose={onClose}><Primary pending={pending} disabled={!date || !reason.trim()} onClick={submit}>Reprogramar</Primary></Footer>}>
      <p className="text-sm">Vence hoy el {payment.due ?? "—"} · {formatMoney(payment.amount)}. El vencimiento original se conserva: el desfase se mide contra él.</p>
      <DialogField label="Nueva fecha de vencimiento"><input type="date" className={fieldInput} value={date} onChange={(e) => setDate(e.target.value)} /></DialogField>
      <DialogField label="Motivo"><textarea className={fieldInput} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></DialogField>
    </SaleModal>
  );
}

// ── Corregir la comisión del procesador (Extra I, F6) ────────────────

export function FeeCorrectionDialog({ payment, currentFee, onClose }: { payment: PayableRow; currentFee: number | null; onClose: () => void }) {
  const router = useRouter();
  const [fee, setFee] = useState(currentFee == null ? "" : String(currentFee));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const result = await correctPaymentFee({ paymentId: payment.id, feeAmount: Number(fee), reason });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <SaleModal title="Corregir la comisión del procesador" label="Corregir la comisión del procesador" onClose={onClose} footer={<Footer error={error} onClose={onClose}><Primary pending={pending} disabled={fee.trim() === "" || !reason.trim()} onClick={submit}>Corregir</Primary></Footer>}>
      <p className="text-sm">Cobrado {formatMoney(payment.amount)}. Se corrige solo lo que se quedó el procesador; el porcentaje y el fijo calculados quedan como registro.</p>
      <DialogField label="Comisión real (USD)"><input type="number" min={0} max={payment.amount} step="0.01" inputMode="decimal" className={fieldInput} value={fee} onChange={(e) => setFee(e.target.value)} /></DialogField>
      <DialogField label="Motivo"><textarea className={fieldInput} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></DialogField>
    </SaleModal>
  );
}

// ── Incobrable / revertir ────────────────────────────────────────────

export function ReasonDialog({ payment, kind, onClose }: { payment: PayableRow; kind: "uncollectible" | "revert"; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const uncollectible = kind === "uncollectible";

  function submit() {
    setError(null);
    start(async () => {
      const result = uncollectible ? await markUncollectible({ paymentId: payment.id, reason }) : await revertPayment({ paymentId: payment.id, reason });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <SaleModal
      title={uncollectible ? "Marcar como incobrable" : "Revertir el cobro"}
      label={uncollectible ? "Marcar como incobrable" : "Revertir el cobro"}
      onClose={onClose}
      footer={<Footer error={error} onClose={onClose}><Primary pending={pending} danger disabled={!reason.trim()} onClick={submit}>{uncollectible ? "Marcar incobrable" : "Revertir"}</Primary></Footer>}
    >
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
        {uncollectible
          ? "Un pago incobrable sale de lo que se espera cobrar, pero NO cambia el saldo de la venta. Se puede volver a poner en cobro."
          : "El pago vuelve a programado o moroso según su fecha, y se borran la fecha de cobro, la comisión y el método que se guardaron."}
      </p>
      <p className="text-sm">{formatMoney(payment.amount)}{payment.due ? ` · vence el ${payment.due}` : ""}</p>
      <DialogField label="Motivo"><textarea className={fieldInput} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></DialogField>
    </SaleModal>
  );
}

// ── Agregar una cuota a mano ─────────────────────────────────────────

export function AddPaymentDialog({ saleId, today, enabledMethods, methods: catalog, onClose }: { saleId: string; today: string; enabledMethods: string[]; methods: PaymentMethodDef[]; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const result = await addPayment({ saleId, amount: Number(amount), dueDate: date, method: method || null });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <SaleModal title="Agregar un pago" label="Agregar un pago" onClose={onClose} footer={<Footer error={error} onClose={onClose}><Primary pending={pending} disabled={!(Number(amount) > 0) || !date} onClick={submit}>Agregar</Primary></Footer>}>
      <p className="text-xs text-muted-foreground">Una cuota a mano (por ejemplo, la diferencia de un cobro parcial). Nace programada.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <DialogField label="Monto"><input type="number" min={0} step="0.01" inputMode="decimal" className={fieldInput} value={amount} onChange={(e) => setAmount(e.target.value)} /></DialogField>
        <DialogField label="Vence"><input type="date" className={fieldInput} value={date} onChange={(e) => setDate(e.target.value)} /></DialogField>
        <DialogField label="Método (opcional)">
          <select className={fieldInput} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">Sin definir</option>
            {selectableMethods(enabledMethods, null, catalog).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
          </select>
        </DialogField>
      </div>
    </SaleModal>
  );
}

// ── Reembolso ────────────────────────────────────────────────────────

export function RefundDialog({ saleId, netPaid, saleDate, today, onClose }: { saleId: string; netPaid: number; saleDate: string; today: string; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(netPaid));
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const total = Number(amount) === netPaid;

  function submit() {
    setError(null);
    start(async () => {
      const result = await createRefund({ saleId, amount: Number(amount), date, reason });
      if (!result.ok) return setError(result.error);
      router.refresh();
      onClose();
    });
  }

  return (
    <SaleModal title="Registrar un reembolso" label="Registrar un reembolso" onClose={onClose} footer={<Footer error={error} onClose={onClose}><Primary pending={pending} danger disabled={!(Number(amount) > 0) || !reason.trim()} onClick={submit}>Registrar reembolso</Primary></Footer>}>
      <p className="text-sm">Cobrado neto: <strong>{formatMoney(netPaid)}</strong>. El reembolso no puede superarlo.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <DialogField label="Monto a reembolsar"><input type="number" min={0} step="0.01" inputMode="decimal" max={netPaid} className={fieldInput} value={amount} onChange={(e) => setAmount(e.target.value)} /></DialogField>
        <DialogField label="Fecha"><input type="date" className={fieldInput} value={date} min={saleDate} max={today} onChange={(e) => setDate(e.target.value)} /></DialogField>
      </div>
      <DialogField label="Motivo"><textarea className={fieldInput} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></DialogField>
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
        {total ? "Cubre todo lo cobrado: la venta pasa a «Reembolsada» y sus pagos programados y morosos se anulan." : "Es un reembolso parcial: el saldo lo refleja y la venta sigue su curso."} El pago original no cambia: sigue cobrado.
      </p>
    </SaleModal>
  );
}
