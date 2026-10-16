/**
 * Gastos automáticos (GF20, GF21, GF22): comisiones de procesador y pauta de Meta. PURO.
 *
 * La parte que escribe es una función SQL (`upsert_auto_expense`, con `SELECT … FOR UPDATE`); esta es su
 * GEMELA: `decideAutoExpenseAction` toma la misma decisión sobre los mismos datos. Los dos corren los casos
 * de `auto-expenses.cases.json` (el SQL desde `verify-expenses.mjs`): si se cambia una regla, se cambia en
 * las dos y se suma el caso.
 *
 * Todo en CÉNTIMOS enteros. Un gasto automático es uno por (método o cuenta, mes): `auto_key`.
 */
import { toCents } from "@/lib/sales/money";
import { addDays, localDate, monthEnd, monthKey, monthLabel, previousMonthKey, type CivilDate } from "./dates";
import { isAutoOrigin, type ExpenseStatus } from "./expense-status";
import type { ChargeMode } from "./settings";

export type AutoKind = "processor_fee" | "meta_ads";

/** «Whop (registrado a mano)» → «Whop», para el concepto y el nombre del proveedor. */
export function shortMethodName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "").trim() || name;
}
export type AutoVoidKind = "manual" | "auto_zero";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---------------------------------------------------------------------------------------------------------
// Claves y textos

/** `processor_fee:whop:2026-10` / `meta_ads:act_123:2026-10`. Es el índice único: una por (origen, mes). */
export function autoKey(kind: AutoKind, ref: string, month: string): string {
  if (!MONTH_RE.test(month)) throw new RangeError(`Mes inválido para un gasto automático: ${month}`);
  if (!ref) throw new RangeError("Un gasto automático necesita su método o su cuenta");
  return `${kind}:${ref}:${month}`;
}

/** Lo inverso de `autoKey`; `null` si no tiene esa forma. */
export function parseAutoKey(key: string | null | undefined): { kind: AutoKind; ref: string; month: string } | null {
  if (!key) return null;
  const first = key.indexOf(":");
  const last = key.lastIndexOf(":");
  if (first <= 0 || last <= first) return null;
  const kind = key.slice(0, first);
  const month = key.slice(last + 1);
  const ref = key.slice(first + 1, last);
  if ((kind !== "processor_fee" && kind !== "meta_ads") || !ref || !MONTH_RE.test(month)) return null;
  return { kind, ref, month };
}

/**
 * El concepto del gasto: «Comisión Whop · octubre 2026» y «Pauta Meta (Cuenta de ejemplo) · octubre 2026».
 * `name` es el nombre a mostrar del método o de la cuenta; lo resuelve quien llama.
 */
export function autoExpenseConcept(args: { kind: AutoKind; name: string; month: string }): string {
  const when = monthLabel(args.month);
  return args.kind === "processor_fee" ? `Comisión ${args.name} · ${when}` : `Pauta Meta (${args.name}) · ${when}`;
}

/** El motivo con que el sistema anula un automático que quedó en cero. */
export function zeroVoidReason(kind: AutoKind): string {
  return kind === "processor_fee" ? "La comisión del mes quedó en cero" : "La pauta del mes quedó en cero";
}

/** Los meses que se recalculan: el actual y los anteriores (`count` = 3 → actual y 2 antes), del más viejo al actual. */
export function monthsInWindow(todayLocal: CivilDate, count = 3): string[] {
  const out: string[] = [];
  let key = monthKey(todayLocal);
  for (let i = 0; i < count; i++) {
    out.unshift(key);
    key = previousMonthKey(key);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// La decisión (gemela de `upsert_auto_expense`)

/** El gasto automático que ya existe para esa clave, tal como está en la base (monto en céntimos). */
export interface ExistingAutoExpense {
  status: ExpenseStatus;
  amountCents: number;
  /** Solo si está anulado. `auto_zero` lo anuló el sistema; `manual`, una persona. */
  voidKind: AutoVoidKind | null;
  /** `auto_drift_amount` en céntimos, con signo; `null` si nunca se marcó diferencia. */
  driftCents: number | null;
  /** `auto_drift_resolved_at IS NOT NULL`. */
  driftResolved: boolean;
  /** Los ajustes ya creados sobre este gasto (`adjusts_expense_id`), con su signo. Solo cuentan si está pagado. */
  adjustmentsCents: number[];
}

export interface AutoDecisionContext {
  /** Hoy en la zona del workspace. */
  todayLocal: CivilDate;
  /** El mes del gasto, `AAAA-MM`. */
  month: string;
  chargeMode: ChargeMode;
}

export type AutoExpenseAction =
  /** No existe y hay total: crearlo. `scheduledDate` = último día del mes. */
  | { kind: "create"; amountCents: number; status: "programado" | "vencido"; scheduledDate: CivilDate }
  /** Existe sin pagar y el total cambió. */
  | { kind: "update_amount"; amountCents: number }
  /** Existe sin pagar y el total quedó en 0: anularlo (`void_kind = 'auto_zero'`). */
  | { kind: "void_zero"; voidKind: "auto_zero" }
  /** Lo había anulado el sistema y volvió a haber total. */
  | { kind: "reactivate"; amountCents: number; status: "programado" | "vencido" }
  /** Pagado y el total difiere de lo pagado + ajustes: marcar la diferencia (no se toca el monto). */
  | { kind: "mark_drift"; driftCents: number }
  /** Pagado, el total ya coincide y había una diferencia sin resolver: limpiarla. */
  | { kind: "clear_drift" }
  | { kind: "none" };

/** Programado, o vencido si el último día del mes ya pasó y el cobro es a mano (el automático lo cierra solo). */
function unpaidStatus(ctx: AutoDecisionContext): "programado" | "vencido" {
  return ctx.chargeMode === "manual" && monthEnd(ctx.month) < ctx.todayLocal ? "vencido" : "programado";
}

/**
 * Lo que dice el total recalculado respecto de lo pagado MÁS los ajustes ya creados (GF22): así un segundo
 * ajuste no duplica el primero. Con signo; 0 = no hay diferencia.
 */
export function driftAgainst(paidCents: number, adjustmentCents: readonly number[], totalCents: number): number {
  return Math.round(totalCents) - (Math.round(paidCents) + adjustmentCents.reduce((a, b) => a + Math.round(b), 0));
}

/**
 * La tabla de 8 casos de GF20 (+ el matiz de GF22 para el pagado):
 *
 *  1. no existe y total > 0                    → crear (programado, o vencido si es manual y el mes ya terminó)
 *  2. no existe y total = 0                    → nada (no se crea un gasto en cero)
 *  3. existe sin pagar y total > 0             → actualizar el monto si cambió
 *  4. existe sin pagar y total = 0             → anular con `auto_zero`
 *  5. anulado por el sistema y total > 0       → reactivar (es la única salida de anulado)
 *  6. anulado por una persona                  → nada
 *  7. pagado y total ≠ lo pagado + ajustes     → no tocar el monto; marcar la diferencia
 *  8. pagado y total = lo pagado + ajustes     → limpiar una diferencia sin resolver (si la hay)
 *
 * Es idempotente: si el estado ya refleja el total devuelve `none`. Una diferencia ya marcada con el mismo
 * valor no se vuelve a marcar (ni a notificar), esté resuelta o no: «Ignorar» no se desanda solo.
 */
export function decideAutoExpenseAction(existing: ExistingAutoExpense | null, totalCents: number, ctx: AutoDecisionContext): AutoExpenseAction {
  const total = Math.max(0, Math.round(Number.isFinite(totalCents) ? totalCents : 0));

  if (!existing) {
    if (total <= 0) return { kind: "none" };
    return { kind: "create", amountCents: total, status: unpaidStatus(ctx), scheduledDate: monthEnd(ctx.month) };
  }

  if (existing.status === "anulado") {
    if (existing.voidKind === "auto_zero" && total > 0) return { kind: "reactivate", amountCents: total, status: unpaidStatus(ctx) };
    return { kind: "none" };
  }

  if (existing.status === "pagado") {
    const drift = driftAgainst(existing.amountCents, existing.adjustmentsCents, total);
    if (drift === 0) {
      const hasOpenDrift = existing.driftCents !== null && existing.driftCents !== 0 && !existing.driftResolved;
      return hasOpenDrift ? { kind: "clear_drift" } : { kind: "none" };
    }
    if (existing.driftCents === drift) return { kind: "none" };
    return { kind: "mark_drift", driftCents: drift };
  }

  // programado, vencido o por_revisar
  if (total <= 0) return { kind: "void_zero", voidKind: "auto_zero" };
  if (existing.amountCents !== total) return { kind: "update_amount", amountCents: total };
  return { kind: "none" };
}

// ---------------------------------------------------------------------------------------------------------
// Cierre automático

export interface AutoCloseCandidate {
  status: string;
  origin: string;
  amount: unknown;
  scheduled_date: string;
  auto_key?: string | null;
}

export interface AutoCloseSetting {
  chargeMode: ChargeMode;
  /** 0 a 10: cuántos días del mes siguiente se espera antes de cerrar. */
  autoCloseDays: number;
}

/** El mes al que pertenece un automático: el de su `auto_key`, o el de su fecha programada (último día del mes). */
function monthOfAuto(expense: AutoCloseCandidate): string {
  return parseAutoKey(expense.auto_key)?.month ?? monthKey(expense.scheduled_date);
}

/** El `paid_date` con que se cierra: el último día del mes del gasto. */
export function autoClosePaidDate(expense: AutoCloseCandidate): CivilDate {
  return monthEnd(monthOfAuto(expense));
}

/**
 * ¿Hay que marcarlo pagado solo? Un automático sin pagar, con cobro automático y más que cero, cuyo mes
 * terminó hace al menos `autoCloseDays` días. Con 3 días: el 2026-11-03 sí, el 2026-11-02 no.
 */
export function shouldAutoClose(expense: AutoCloseCandidate, setting: AutoCloseSetting, todayLocal: CivilDate): boolean {
  if (!isAutoOrigin(expense.origin)) return false;
  if (setting.chargeMode !== "automatic") return false;
  if (expense.status !== "programado" && expense.status !== "vencido") return false;
  if (toCents(expense.amount) <= 0) return false;
  const lastDay = autoClosePaidDate(expense);
  // El mes tiene que haber terminado (con 0 días no se cierra el propio último día) y haber pasado la espera.
  return todayLocal > lastDay && todayLocal >= addDays(lastDay, Math.max(0, Math.round(setting.autoCloseDays)));
}

// ---------------------------------------------------------------------------------------------------------
// Las dos fuentes del total

/**
 * Suma exacta de importes decimales en céntimos: como el `SUM(numeric)` de SQL (se suma en micro-unidades
 * enteras y se redondea al final, la mitad se aleja del cero como `round()` de Postgres), no céntimo por
 * céntimo.
 */
function sumAmountsToCents(values: readonly unknown[]): number {
  let micros = 0;
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) micros += Math.round(n * 1_000_000);
  }
  const cents = Math.abs(micros) / 10_000;
  return (micros < 0 ? -1 : 1) * Math.floor(cents + 0.5);
}

export interface FeePayment {
  payment_method: string | null;
  type: string;
  status: string;
  provider_fee_amount: unknown;
  paid_at: string | null;
}

/**
 * La comisión del mes (GF20): suma de `provider_fee_amount` de los pagos del método, `paid`, que NO son
 * reembolso (un pago luego reembolsado sigue `paid` con su comisión, que no vuelve), cobrados dentro del
 * mes calendario LOCAL de la zona `tz`: un pago del 2026-10-31 23:30 en Costa Rica cuenta en octubre.
 */
export function sumProcessorFeeCents(payments: readonly FeePayment[], method: string, month: string, tz: string): number {
  const fees: unknown[] = [];
  for (const p of payments) {
    if (p.payment_method !== method || p.status !== "paid" || p.type === "refund" || !p.paid_at) continue;
    if (monthKey(localDate(p.paid_at, tz)) !== month) continue;
    fees.push(p.provider_fee_amount);
  }
  return sumAmountsToCents(fees);
}

export interface MetaInsightRow {
  ad_account_id: string;
  level: string;
  /** `AAAA-MM-DD`, el día de la cuenta (no se convierte de zona). */
  date: string;
  spend: unknown;
}

/**
 * La pauta del mes (GF21): suma de `spend` SOLO del nivel `account`. Nunca de `campaign` ni de otro nivel:
 * sumarlos junto con el de cuenta duplica el gasto.
 */
export function sumMetaSpendCents(rows: readonly MetaInsightRow[], accountId: string, month: string): number {
  const spend: unknown[] = [];
  for (const r of rows) {
    if (r.ad_account_id !== accountId || r.level !== "account") continue;
    if (monthKey(r.date.slice(0, 10)) !== month) continue;
    spend.push(r.spend);
  }
  return sumAmountsToCents(spend);
}

/** ¿La cuenta tiene filas de nivel `account` en el mes? Sin ellas el trabajo anota «sin datos de nivel cuenta» y no crea nada. */
export function hasMetaAccountLevelRows(rows: readonly MetaInsightRow[], accountId: string, month: string): boolean {
  return rows.some((r) => r.ad_account_id === accountId && r.level === "account" && monthKey(r.date.slice(0, 10)) === month);
}
