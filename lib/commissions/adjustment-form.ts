/**
 * El formulario del ajuste (F64). Puro: valida lo que escribe la persona con la MISMA regla que el servidor
 * (`commissionAdjustmentSchema`) y arma lo que se manda. Tiene dos caras:
 *
 *   - Manual: «+ Ajuste» (o «Crear ajuste» desde la ficha de una comisión). Una persona, un monto.
 *   - Por un reembolso: una línea por persona con la sugerencia del sistema (editable). **No se crea nada solo**:
 *     lo que no está tildado no se carga.
 */
import { formatUsd } from "@/lib/finance/format";
import { parseAmountText } from "@/lib/finance/expense-form";
import { fromCents } from "@/lib/shared/money";
import type { RefundSuggestionResult } from "./action-types";
import { ADJUSTMENT_NOTES_MAX, commissionAdjustmentSchema } from "./adjustment";

/** Lo que se manda a `createCommissionAdjustment`. */
export interface AdjustmentPayload {
  userId: string;
  /** Dólares. */
  amount: number;
  notes: string;
  saleId: string | null;
  paymentId: string | null;
  role: string | null;
}

export type FormCheck<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function checkPayload(payload: AdjustmentPayload): FormCheck<AdjustmentPayload> {
  const parsed = commissionAdjustmentSchema.safeParse(payload);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Los datos no son válidos");
  return { ok: true, value: payload };
}

export interface ManualAdjustmentForm {
  userId: string;
  amountText: string;
  notes: string;
  saleId: string | null;
  paymentId: string | null;
  role: string | null;
}

export function validateManualAdjustment(form: ManualAdjustmentForm): FormCheck<AdjustmentPayload> {
  if (!form.userId) return fail("Elegí a quién va el ajuste");
  const amount = parseAmountText(form.amountText, { allowNegative: true });
  if (amount.kind === "empty") return fail("Poné el monto (negativo si resta)");
  if (amount.kind === "invalid") return fail(amount.error);
  if (amount.cents === 0) return fail("El monto no puede ser 0");
  if (!form.notes.trim()) return fail("Contá el motivo del ajuste");
  if (form.notes.trim().length > ADJUSTMENT_NOTES_MAX) return fail(`El motivo puede tener hasta ${ADJUSTMENT_NOTES_MAX} caracteres`);
  if (form.paymentId && !form.saleId) return fail("Elegí primero la venta del pago");
  return checkPayload({
    userId: form.userId,
    amount: fromCents(amount.cents),
    notes: form.notes.trim(),
    saleId: form.saleId,
    paymentId: form.paymentId,
    role: form.role || null,
  });
}

// ── Por un reembolso ───────────────────────────────────────────────────

export interface RefundRowForm {
  userId: string;
  userName: string;
  /** Si todas las comisiones de la persona son del mismo rol, ese; si no, `null`. */
  role: string | null;
  originalCents: number;
  suggestedCents: number;
  alreadyAdjustedCents: number;
  /** Lo que escribe la persona (puede cambiar la sugerencia). */
  amountText: string;
  /** ¿Se carga? Por defecto sí, salvo que no haya sugerencia o ya se haya ajustado algo por este reembolso. */
  included: boolean;
}

/** «−19,41» o «» (sin sugerencia): el texto que arranca en el campo. */
export function suggestionText(cents: number): string {
  if (cents === 0) return "";
  return `${cents < 0 ? "-" : ""}${(Math.abs(cents) / 100).toFixed(2).replace(".", ",")}`;
}

export function refundRowsFromSuggestions(result: Pick<RefundSuggestionResult, "suggestions">): RefundRowForm[] {
  return result.suggestions.map((s) => {
    const roles = [...new Set(s.commissions.map((c) => c.role))];
    return {
      userId: s.userId,
      userName: s.userName ?? "Una persona que ya no está en el equipo",
      role: roles.length === 1 ? roles[0] : null,
      originalCents: s.originalCents,
      suggestedCents: s.suggestedCents,
      alreadyAdjustedCents: s.alreadyAdjustedCents,
      amountText: suggestionText(s.suggestedCents),
      included: s.suggestedCents !== 0 && s.alreadyAdjustedCents === 0,
    };
  });
}

/** «Reembolso de USD 250,00 sobre USD 500,00 cobrados (50 %)». */
export function refundNotes(refundedCents: number, paidCents: number): string {
  const pct = paidCents > 0 ? Math.min(100, Math.round((refundedCents / paidCents) * 1000) / 10) : null;
  const pctText = pct === null ? "" : ` (${String(pct).replace(".", ",")} %)`;
  return `Reembolso de ${formatUsd(refundedCents)} sobre ${formatUsd(paidCents)} cobrados${pctText}`;
}

/**
 * Los ajustes a cargar de un reembolso: uno por cada línea tildada. Un reembolso RESTA, así que el monto tiene que
 * ser negativo. Si no hay ninguna tildada, no hay nada para cargar.
 */
export function validateRefundAdjustments(args: { rows: readonly RefundRowForm[]; notes: string; saleId: string; refundPaymentId: string }): FormCheck<AdjustmentPayload[]> {
  const chosen = args.rows.filter((r) => r.included);
  if (chosen.length === 0) return fail("Tildá al menos una persona para cargarle el ajuste");
  const payloads: AdjustmentPayload[] = [];
  for (const row of chosen) {
    const amount = parseAmountText(row.amountText, { allowNegative: true });
    if (amount.kind === "empty") return fail(`Poné el monto del ajuste de ${row.userName}`);
    if (amount.kind === "invalid") return fail(`${row.userName}: ${amount.error}`);
    if (amount.cents >= 0) return fail(`${row.userName}: un reembolso resta, el monto tiene que ser negativo`);
    const checked = checkPayload({
      userId: row.userId,
      amount: fromCents(amount.cents),
      notes: args.notes.trim(),
      saleId: args.saleId,
      paymentId: args.refundPaymentId,
      role: row.role,
    });
    if (!checked.ok) return fail(`${row.userName}: ${checked.error}`);
    payloads.push(checked.value);
  }
  return { ok: true, value: payloads };
}
