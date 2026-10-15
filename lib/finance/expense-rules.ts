/**
 * Las reglas de un gasto (GF7, GF9, GF10): alta, edición, pagar, revertir, anular, duplicar. Puras: las
 * Server Actions solo las llaman y escriben. La plata se decide en CÉNTIMOS enteros y las fechas son civiles
 * en la zona del workspace (`todayLocal` lo calcula quien llama).
 *
 * El trigger `expenses_guard` de la base repite lo esencial (un pagado no cambia monto/fechas, un anulado no
 * se edita, un automático no se edita a mano): estas reglas dan el mensaje claro ANTES de llegar a la base.
 */
import { fromCents, toCents } from "@/lib/sales/money";
import { activeCategories, findCategory, type ExpenseCategory } from "./categories";
import { isDateOnly, type CivilDate } from "./dates";
import { isAutoOrigin, unpaidStatusFor, type ExpenseStatus } from "./expense-status";

export type RuleResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export const CONCEPT_MAX = 200;
export const NOTES_MAX = 2000;
export const REASON_MAX = 500;
/** Por encima de este monto se pide confirmar (aviso no bloqueante). */
export const HIGH_AMOUNT_CENTS = 10_000_000;

export interface ExpenseRowLite {
  status: string;
  origin: string;
  amount: unknown;
  scheduled_date: string;
  paid_date: string | null;
  concept: string;
  vendor_id: string | null;
  category_key: string;
  responsible_id: string | null;
  notes: string | null;
  recurring_expense_id?: string | null;
  adjusts_expense_id?: string | null;
}

export interface RuleContext {
  todayLocal: CivilDate;
  categories: readonly ExpenseCategory[];
}

const trimOrNull = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

function checkConcept(concept: string): string | null {
  const c = concept.trim();
  if (!c) return "Poné un concepto";
  if (c.length > CONCEPT_MAX) return `El concepto puede tener hasta ${CONCEPT_MAX} caracteres`;
  return null;
}

function checkNotes(notes: string | null | undefined): string | null {
  return (notes ?? "").length > NOTES_MAX ? `Las notas pueden tener hasta ${NOTES_MAX} caracteres` : null;
}

// ── Alta ───────────────────────────────────────────────────────────────

export interface CreateExpenseInput {
  concept: string;
  vendorId?: string | null;
  categoryKey: string;
  /** En dólares. Se ignora con `amountToConfirm`. */
  amount?: unknown;
  /** «Monto a confirmar»: nace Por revisar con monto 0. */
  amountToConfirm?: boolean;
  scheduledDate: string;
  responsibleId?: string | null;
  notes?: string | null;
  /** «Ya está pagado». */
  paid?: boolean;
  paidDate?: string | null;
}

export interface NewExpenseRow {
  concept: string;
  vendor_id: string | null;
  category_key: string;
  amount: number;
  status: ExpenseStatus;
  scheduled_date: string;
  paid_date: string | null;
  origin: "manual";
  responsible_id: string | null;
  notes: string | null;
}

export function planCreateExpense(input: CreateExpenseInput, ctx: RuleContext): RuleResult<{ row: NewExpenseRow; highAmount: boolean }> {
  const conceptError = checkConcept(input.concept);
  if (conceptError) return { ok: false, error: conceptError };
  const notesError = checkNotes(input.notes);
  if (notesError) return { ok: false, error: notesError };

  const category = findCategory(ctx.categories, input.categoryKey);
  if (!category || !activeCategories(ctx.categories).some((c) => c.key === category.key)) return { ok: false, error: "Elegí una categoría activa" };
  if (!isDateOnly(input.scheduledDate)) return { ok: false, error: "La fecha programada no es válida" };

  const toConfirm = input.amountToConfirm === true;
  const paid = input.paid === true;
  if (toConfirm && paid) return { ok: false, error: "Un gasto sin monto no se puede marcar como pagado: cargá primero el monto" };

  let amountCents = 0;
  if (!toConfirm) {
    amountCents = toCents(input.amount);
    if (!(amountCents > 0)) return { ok: false, error: "El monto tiene que ser mayor que cero (o marcá «Monto a confirmar»)" };
  }

  let paidDate: string | null = null;
  if (paid) {
    paidDate = input.paidDate && input.paidDate !== "" ? input.paidDate : ctx.todayLocal;
    if (!isDateOnly(paidDate)) return { ok: false, error: "La fecha de pago no es válida" };
    if (paidDate > ctx.todayLocal) return { ok: false, error: "La fecha de pago no puede ser futura" };
  }

  const status: ExpenseStatus = paid ? "pagado" : toConfirm ? "por_revisar" : unpaidStatusFor(input.scheduledDate, ctx.todayLocal);
  return {
    ok: true,
    highAmount: amountCents >= HIGH_AMOUNT_CENTS,
    row: {
      concept: input.concept.trim(),
      vendor_id: input.vendorId || null,
      category_key: category.key,
      amount: fromCents(amountCents),
      status,
      scheduled_date: input.scheduledDate,
      paid_date: paidDate,
      origin: "manual",
      responsible_id: input.responsibleId || null,
      notes: trimOrNull(input.notes),
    },
  };
}

// ── Edición ────────────────────────────────────────────────────────────

export interface UpdateExpenseInput {
  concept: string;
  vendorId?: string | null;
  categoryKey: string;
  amount?: unknown;
  scheduledDate: string;
  responsibleId?: string | null;
  notes?: string | null;
}

export interface ExpensePatch {
  concept: string;
  vendor_id: string | null;
  category_key: string;
  amount: number;
  scheduled_date: string;
  responsible_id: string | null;
  notes: string | null;
  status: ExpenseStatus;
}

/**
 * Editar. Concepto, proveedor, categoría, responsable y notas, en cualquier estado salvo anulado. Monto y fecha
 * programada, solo si NO está pagado. Un automático no pagado no deja cambiar monto ni concepto (los recalcula el
 * sistema). Guardar un Por revisar con monto > 0 = «Confirmar monto»: pasa a programado o vencido.
 */
export function planUpdateExpense(existing: ExpenseRowLite, input: UpdateExpenseInput, ctx: RuleContext): RuleResult<{ patch: ExpensePatch; highAmount: boolean }> {
  if (existing.status === "anulado") return { ok: false, error: "Un gasto anulado no se edita" };
  const conceptError = checkConcept(input.concept);
  if (conceptError) return { ok: false, error: conceptError };
  const notesError = checkNotes(input.notes);
  if (notesError) return { ok: false, error: notesError };
  if (!isDateOnly(input.scheduledDate)) return { ok: false, error: "La fecha programada no es válida" };

  const sameCategory = input.categoryKey === existing.category_key;
  const category = findCategory(ctx.categories, input.categoryKey);
  // Se puede conservar una categoría archivada que el gasto ya tenía; no se elige una archivada para otra.
  if (!category || (!sameCategory && category.archived_at)) return { ok: false, error: "Elegí una categoría activa" };

  const existingCents = toCents(existing.amount);
  const nextCents = input.amount === undefined || input.amount === null || input.amount === "" ? existingCents : toCents(input.amount);
  const paid = existing.status === "pagado";

  if (paid) {
    if (nextCents !== existingCents) return { ok: false, error: "Revertí el pago primero para cambiar el monto" };
    if (input.scheduledDate !== existing.scheduled_date) return { ok: false, error: "Revertí el pago primero para cambiar la fecha" };
  }
  if (isAutoOrigin(existing.origin) && !paid) {
    if (nextCents !== existingCents) return { ok: false, error: "Este monto lo calcula el sistema todos los días. Se congela cuando lo marcás pagado." };
    if (input.concept.trim() !== existing.concept) return { ok: false, error: "El concepto de un gasto automático lo arma el sistema" };
  }
  if (existing.origin === "commission_payout") {
    if (nextCents !== existingCents) return { ok: false, error: "El monto de una liquidación es la suma de sus comisiones: anulala y generala de nuevo" };
    if ((input.vendorId || null) !== existing.vendor_id) return { ok: false, error: "No se cambia la persona de una liquidación: anulala y generala de nuevo" };
  }
  if (existing.origin === "adjustment") {
    if (nextCents === 0) return { ok: false, error: "Un ajuste no puede ser de cero" };
  } else if (nextCents < 0) {
    return { ok: false, error: "El monto no puede ser negativo" };
  }

  let status = existing.status as ExpenseStatus;
  if (existing.status === "por_revisar") {
    // Confirmar el monto: con monto > 0 pasa a programado o vencido según su fecha.
    if (nextCents > 0) status = unpaidStatusFor(input.scheduledDate, ctx.todayLocal);
  } else if (existing.status === "programado" || existing.status === "vencido") {
    if (!(nextCents > 0) && existing.origin !== "adjustment") return { ok: false, error: "El monto tiene que ser mayor que cero" };
    status = unpaidStatusFor(input.scheduledDate, ctx.todayLocal);
  }

  return {
    ok: true,
    highAmount: nextCents >= HIGH_AMOUNT_CENTS,
    patch: {
      concept: input.concept.trim(),
      vendor_id: input.vendorId || null,
      category_key: category.key,
      amount: fromCents(nextCents),
      scheduled_date: input.scheduledDate,
      responsible_id: input.responsibleId || null,
      notes: trimOrNull(input.notes),
      status,
    },
  };
}

// ── Pagar / revertir / anular ──────────────────────────────────────────

export interface PayInput {
  paidDate?: string | null;
  /** Obligatorio en Por revisar; en los demás viene cargado y se puede corregir si no es automático. */
  amount?: unknown;
}

export function planPayExpense(existing: ExpenseRowLite, input: PayInput, ctx: RuleContext): RuleResult<{ patch: { status: "pagado"; paid_date: string; amount: number } }> {
  if (existing.status === "pagado") return { ok: false, error: `Este gasto ya se marcó pagado el ${existing.paid_date ?? ""}`.trim() };
  if (existing.status === "anulado") return { ok: false, error: "Un gasto anulado no se paga" };
  const paidDate = input.paidDate && input.paidDate !== "" ? input.paidDate : ctx.todayLocal;
  if (!isDateOnly(paidDate)) return { ok: false, error: "La fecha de pago no es válida" };
  if (paidDate > ctx.todayLocal) return { ok: false, error: "La fecha de pago no puede ser futura" };

  const existingCents = toCents(existing.amount);
  let cents = existingCents;
  if (input.amount !== undefined && input.amount !== null && input.amount !== "") {
    cents = toCents(input.amount);
    if (cents !== existingCents && isAutoOrigin(existing.origin)) return { ok: false, error: "El monto de un gasto automático lo calcula el sistema" };
    if (cents !== existingCents && existing.origin === "commission_payout") return { ok: false, error: "El monto de una liquidación no se cambia: anulala y generala de nuevo" };
  }
  if (existing.status === "por_revisar" && !(cents > 0)) return { ok: false, error: "Cargá el monto para poder pagarlo" };
  if (existing.origin === "adjustment") {
    if (cents === 0) return { ok: false, error: "Un ajuste no puede ser de cero" };
  } else if (!(cents > 0)) {
    return { ok: false, error: "El monto tiene que ser mayor que cero" };
  }
  return { ok: true, patch: { status: "pagado", paid_date: paidDate, amount: fromCents(cents) } };
}

export function planRevertExpense(existing: ExpenseRowLite, reason: string | null | undefined, ctx: RuleContext): RuleResult<{ target: "programado" | "vencido" }> {
  if (existing.status !== "pagado") return { ok: false, error: "Solo se puede revertir un gasto pagado" };
  const r = (reason ?? "").trim();
  if (!r) return { ok: false, error: "Explicá el motivo" };
  if (r.length > REASON_MAX) return { ok: false, error: `El motivo puede tener hasta ${REASON_MAX} caracteres` };
  return { ok: true, target: unpaidStatusFor(existing.scheduled_date, ctx.todayLocal) };
}

export function planVoidExpense(existing: ExpenseRowLite, reason: string | null | undefined): RuleResult<{ reason: string }> {
  if (existing.status === "pagado") return { ok: false, error: "Revertí el pago primero" };
  if (existing.status === "anulado") return { ok: false, error: "Este gasto ya está anulado" };
  const r = (reason ?? "").trim();
  if (!r) return { ok: false, error: "Explicá el motivo" };
  if (r.length > REASON_MAX) return { ok: false, error: `El motivo puede tener hasta ${REASON_MAX} caracteres` };
  return { ok: true, reason: r };
}

// ── Duplicar ───────────────────────────────────────────────────────────

/** Lo que se copia al abrir el alta: concepto, proveedor, categoría, monto, responsable y notas. La fecha queda vacía. */
export function duplicateDraft(existing: ExpenseRowLite): Pick<CreateExpenseInput, "concept" | "vendorId" | "categoryKey" | "amount" | "responsibleId" | "notes"> & { scheduledDate: "" } {
  return {
    concept: existing.concept,
    vendorId: existing.vendor_id,
    categoryKey: existing.category_key,
    amount: existing.status === "por_revisar" ? "" : existing.amount,
    responsibleId: existing.responsible_id,
    notes: existing.notes,
    scheduledDate: "",
  };
}

/** Ajuste de una comisión cambiada (GF22): hereda proveedor y categoría. */
export function adjustmentConcept(original: string): string {
  return `Ajuste: ${original}`.slice(0, CONCEPT_MAX);
}
