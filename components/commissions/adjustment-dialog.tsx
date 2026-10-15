"use client";

import { useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { SaleModal } from "@/components/sales/sale-modal";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { createCommissionAdjustment } from "@/lib/actions/commissions";
import { listPaymentsForAdjustment, searchSalesForAdjustment } from "@/lib/actions/commissions-ui";
import type { RefundSuggestionResult } from "@/lib/commissions/action-types";
import {
  refundNotes, refundRowsFromSuggestions, validateManualAdjustment, validateRefundAdjustments, type AdjustmentPayload, type RefundRowForm,
} from "@/lib/commissions/adjustment-form";
import { ADJUSTMENT_NOTES_MAX } from "@/lib/commissions/adjustment";
import type { PaymentOption, SaleOption } from "@/lib/commissions/ui-action-types";
import { formatUsd } from "@/lib/finance/format";

/**
 * El ajuste manual de una comisión (F64), con dos caras:
 *
 *   - «+ Ajuste» o «Crear ajuste» desde la ficha: una persona, un monto (puede ser negativo), un motivo, y
 *     opcionalmente la venta, el pago y el rol.
 *   - «Ajustar comisiones de este reembolso»: el sistema sugiere un ajuste por persona (lo que le tocaría devolver
 *     en proporción a lo reembolsado) y la persona decide: puede tildar, cambiar el monto o no cargar nada.
 *     **No se crea nada solo.**
 */
export interface AdjustmentSeed {
  userId?: string;
  saleId?: string;
  saleLabel?: string;
  paymentId?: string;
  paymentLabel?: string;
  role?: string | null;
}

export interface AdjustmentDialogProps {
  members: ReadonlyArray<{ id: string; name: string }>;
  roles: ReadonlyArray<{ key: string; name: string; active: boolean }>;
  seed?: AdjustmentSeed;
  /** Con esto, la cara «por un reembolso». */
  refund?: RefundSuggestionResult | null;
  onClose: () => void;
  /** Se cargó al menos un ajuste: quien llama refresca. */
  onDone: () => void;
}

export function AdjustmentDialog(props: AdjustmentDialogProps) {
  return props.refund ? <RefundAdjustments {...props} refund={props.refund} /> : <ManualAdjustment {...props} />;
}

function Footer({ error, onClose, pending, disabled, onSubmit, label }: { error: string | null; onClose: () => void; pending: boolean; disabled?: boolean; onSubmit: () => void; label: string }) {
  return (
    <>
      {error && <p role="alert" className="mr-auto min-w-0 text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="ml-auto flex gap-2">
        <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
        <button type="button" disabled={pending || disabled} onClick={onSubmit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {label}
        </button>
      </div>
    </>
  );
}

// ── Manual ─────────────────────────────────────────────────────────────

function ManualAdjustment({ members, roles, seed, onClose, onDone }: AdjustmentDialogProps) {
  const [userId, setUserId] = useState(seed?.userId ?? "");
  const [amountText, setAmountText] = useState("");
  const [notes, setNotes] = useState("");
  const [role, setRole] = useState(seed?.role ?? "");
  const [sale, setSale] = useState<SaleOption | null>(seed?.saleId ? { id: seed.saleId, label: seed.saleLabel ?? "La venta de la comisión" } : null);
  const [payments, setPayments] = useState<PaymentOption[]>(seed?.paymentId ? [{ id: seed.paymentId, label: seed.paymentLabel ?? "El pago de la comisión" }] : []);
  const [paymentId, setPaymentId] = useState(seed?.paymentId ?? "");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<SaleOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function search() {
    setError(null);
    setSearching(true);
    const res = await searchSalesForAdjustment(query);
    setSearching(false);
    if (!res.ok) return setError(res.error);
    setFound(res.sales);
  }

  async function pickSale(option: SaleOption) {
    setError(null);
    setSale(option);
    setFound(null);
    setPaymentId("");
    setPayments([]);
    const res = await listPaymentsForAdjustment(option.id);
    if (!res.ok) return setError(res.error);
    setPayments(res.payments);
  }

  function clearSale() {
    setSale(null);
    setPayments([]);
    setPaymentId("");
  }

  function submit() {
    setError(null);
    const checked = validateManualAdjustment({ userId, amountText, notes, saleId: sale?.id ?? null, paymentId: paymentId || null, role: role || null });
    if (!checked.ok) return setError(checked.error);
    start(async () => {
      const res = await createCommissionAdjustment(checked.value);
      if (!res.ok) return setError(res.error);
      onDone();
      onClose();
    });
  }

  const activeRoles = roles.filter((r) => r.active || r.key === seed?.role);

  return (
    <SaleModal
      title="Crear ajuste"
      label="Crear un ajuste de comisión"
      onClose={onClose}
      footer={<Footer error={error} onClose={onClose} pending={pending} onSubmit={submit} label="Guardar ajuste" />}
    >
      <p className="text-sm text-muted-foreground">Un ajuste suma o resta a mano. Después se puede pasar a un gasto igual que cualquier comisión. Si resta, poné el monto con un menos delante.</p>

      <DialogField label="¿A quién va?">
        <select className={fieldInput} value={userId} onChange={(e) => setUserId(e.target.value)} aria-required="true">
          <option value="">Elegí una persona</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </DialogField>

      <DialogField label="Monto (USD)" hint="Por ejemplo 50 o -19,41. Distinto de cero.">
        <input className={fieldInput} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="-19,41" />
      </DialogField>

      <DialogField label="Motivo" hint={`${notes.length}/${ADJUSTMENT_NOTES_MAX}`}>
        <textarea className={`${fieldInput} min-h-20`} maxLength={ADJUSTMENT_NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Por qué se hace este ajuste" />
      </DialogField>

      <fieldset className="space-y-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-xs font-medium">Venta y pago (opcional)</legend>
        {sale ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{sale.label}</span>
            <button type="button" onClick={clearSale} aria-label="Quitar la venta" className="rounded-md p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" aria-hidden /></button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                className={fieldInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void search();
                  }
                }}
                placeholder="Buscar por el nombre del contacto"
                aria-label="Buscar una venta por el nombre del contacto"
              />
              <button type="button" onClick={() => void search()} disabled={searching || query.trim().length < 2} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />} Buscar
              </button>
            </div>
            {found && (found.length === 0 ? (
              <p role="status" className="text-xs text-muted-foreground">No encontré ventas con ese nombre.</p>
            ) : (
              <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border" aria-label="Ventas encontradas">
                {found.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => void pickSale(s)} className="w-full px-3 py-2 text-left text-sm hover:bg-accent">{s.label}</button>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        )}
        {sale && (
          <DialogField label="Pago">
            <select className={fieldInput} value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
              <option value="">Sin un pago puntual</option>
              {payments.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </DialogField>
        )}
      </fieldset>

      <DialogField label="Rol (opcional)" hint="Sirve para agrupar y filtrar. Sin rol, el ajuste aparece como «Ajuste».">
        <select className={fieldInput} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Sin rol</option>
          {activeRoles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
      </DialogField>
    </SaleModal>
  );
}

// ── Por un reembolso ───────────────────────────────────────────────────

function RefundAdjustments({ refund, onClose, onDone }: AdjustmentDialogProps & { refund: RefundSuggestionResult }) {
  const [rows, setRows] = useState<RefundRowForm[]>(() => refundRowsFromSuggestions(refund));
  const [notes, setNotes] = useState(() => refundNotes(refund.refundedCents, refund.paidCents));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const patch = (userId: string, change: Partial<RefundRowForm>) => setRows((list) => list.map((r) => (r.userId === userId ? { ...r, ...change } : r)));

  function submit() {
    setError(null);
    const checked = validateRefundAdjustments({ rows, notes, saleId: refund.saleId, refundPaymentId: refund.refundPaymentId });
    if (!checked.ok) return setError(checked.error);
    start(async () => {
      const made: AdjustmentPayload[] = [];
      for (const payload of checked.value) {
        const res = await createCommissionAdjustment(payload);
        if (!res.ok) {
          const who = rows.find((r) => r.userId === payload.userId)?.userName ?? "una persona";
          if (made.length > 0) {
            // Lo que ya se cargó no se vuelve a cargar si la persona reintenta: queda destildado y con su aviso.
            setRows((list) => list.map((r) => {
              const done = made.find((m) => m.userId === r.userId);
              return done ? { ...r, included: false, alreadyAdjustedCents: Math.round(done.amount * 100) } : r;
            }));
            onDone();
          }
          return setError(`${made.length > 0 ? `Se cargaron ${made.length}, pero ` : ""}no pude cargar el ajuste de ${who}: ${res.error}`);
        }
        made.push(payload);
      }
      onDone();
      onClose();
    });
  }

  return (
    <SaleModal
      title="Ajustar comisiones de este reembolso"
      label="Ajustar las comisiones de un reembolso"
      size="lg"
      onClose={onClose}
      footer={<Footer error={error} onClose={onClose} pending={pending} disabled={rows.length === 0} onSubmit={submit} label="Cargar los ajustes tildados" />}
    >
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
        Se reembolsaron <strong>{formatUsd(refund.refundedCents)}</strong> de los <strong>{formatUsd(refund.paidCents)}</strong> cobrados en el pago original. Esto es una sugerencia en proporción: revisala y cambiá lo que haga falta. No se carga nada hasta que apretás el botón.
      </p>

      {rows.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">El pago original no generó comisiones con persona asignada: no hay nada para ajustar.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">Ajuste sugerido por persona</caption>
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Cargar</span></th>
                <th scope="col" className="px-3 py-2 font-medium">Persona</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Cobró</th>
                <th scope="col" className="px-3 py-2 font-medium">Ajuste (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={r.included} onChange={(e) => patch(r.userId, { included: e.target.checked })} aria-label={`Cargar el ajuste de ${r.userName}`} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.userName}</span>
                    {r.alreadyAdjustedCents !== 0 && <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-300">Ya se le ajustó {formatUsd(r.alreadyAdjustedCents)} por este reembolso</span>}
                    {r.suggestedCents === 0 && <span className="mt-0.5 block text-[11px] text-muted-foreground">No hay nada que sugerir</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatUsd(r.originalCents)}</td>
                  <td className="px-3 py-2">
                    <input
                      className={`${fieldInput} min-w-24`}
                      inputMode="decimal"
                      value={r.amountText}
                      onChange={(e) => patch(r.userId, { amountText: e.target.value, included: true })}
                      aria-label={`Monto del ajuste de ${r.userName}`}
                      placeholder="-0,00"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DialogField label="Motivo (va en cada ajuste)" hint={`${notes.length}/${ADJUSTMENT_NOTES_MAX}`}>
        <textarea className={`${fieldInput} min-h-20`} maxLength={ADJUSTMENT_NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </DialogField>
    </SaleModal>
  );
}
