/**
 * Lo que las pantallas de Gastos necesitan decidir antes de pintar (GF5, GF7, GF12): cómo se ve una fecha civil,
 * el color de cada estado, de dónde salió un gasto, el aviso de diferencia y el link del CSV. Puro: los
 * componentes solo componen lo que sale de acá.
 */
import { toCents } from "@/lib/sales/money";
import { CATEGORY_GROUPS, CATEGORY_GROUP_LABELS, type CategoryGroup, type ExpenseCategory } from "./categories";
import { monthLabel } from "./dates";
import { EXPENSE_STATUSES, isExpenseStatus, type StatusTone } from "./expense-status";
import { serializeExpenseFilters, type ExpenseFilters } from "./expense-filters";
import { formatUsd } from "./format";
import { EXPENSES_CSV_LIMIT } from "./expenses-csv";
import { RECEIPT_MAX_BYTES } from "./receipts";

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** `2026-10-05` → `5 oct 2026`. Una fecha civil no tiene zona: no pasa por `Date`. */
export function formatCivilDate(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!m) return "—";
  const month = Number(m[2]);
  if (month < 1 || month > 12) return "—";
  return `${Number(m[3])} ${MONTHS_SHORT[month - 1]} ${m[1]}`;
}

const TONES: Record<StatusTone, string> = {
  amber: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  blue: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
  red: "bg-red-500/12 text-red-600 dark:text-red-300",
  green: "bg-green-500/12 text-green-600 dark:text-green-300",
  gray: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-300",
};

/** Las clases del chip de un estado (un color por estado en todas las pantallas). */
export function expenseStatusClasses(status: string): string {
  return TONES[isExpenseStatus(status) ? EXPENSE_STATUSES[status].tone : "gray"];
}

/** El monto de un ajuste puede ser negativo y se pinta en rojo. */
export function amountClasses(amount: unknown): string {
  return toCents(amount) < 0 ? "text-red-600 dark:text-red-400" : "";
}

// ── De dónde salió ─────────────────────────────────────────────────────

export interface OriginInput {
  origin: string;
  source_ref?: unknown;
  recurring_expense_id?: string | null;
  adjusts_expense_id?: string | null;
}

export interface OriginLookups {
  /** El concepto de la plantilla recurrente (si se pudo leer). */
  recurringConcept?: string | null;
  /** El concepto del gasto que este ajusta (si se pudo leer). */
  adjustedConcept?: string | null;
  /** Nombre de un método de pago por su clave. */
  methodName?: (key: string) => string;
}

export interface OriginDescription {
  kind: "manual" | "recurring" | "processor_fee" | "meta_ads" | "adjustment" | "commission_payout" | "unknown";
  /** Una línea corta para el título de la sección. */
  title: string;
  /** El resumen (cuántos pagos, qué mes…). */
  detail: string | null;
  /** A dónde lleva el link, si hay. */
  href: string | null;
  linkLabel: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** De dónde salió un gasto, leyendo `origin` y `source_ref` (que nunca se asume completo). */
export function describeOrigin(input: OriginInput, lookups: OriginLookups = {}): OriginDescription {
  const ref = asRecord(input.source_ref);
  const month = typeof ref.month === "string" && MONTH_KEY.test(ref.month) ? monthLabel(ref.month) : null;
  switch (input.origin) {
    case "manual":
      return { kind: "manual", title: "Cargado a mano", detail: null, href: null, linkLabel: null };
    case "recurring":
      return {
        kind: "recurring",
        title: "Gasto recurrente",
        detail: lookups.recurringConcept ? `Sale de la plantilla «${lookups.recurringConcept}».` : "Sale de una plantilla de gastos recurrentes.",
        href: "/dashboard/finanzas/recurrentes",
        linkLabel: "Ver los recurrentes",
      };
    case "processor_fee": {
      const method = typeof ref.method === "string" ? (lookups.methodName?.(ref.method) ?? ref.method) : null;
      const count = Number(ref.payment_count);
      const parts = [
        `Comisiones${method ? ` de ${method}` : ""}${month ? ` de ${month}` : ""}`,
        Number.isFinite(count) && ref.payment_count !== undefined ? plural(count, "pago", "pagos") : null,
      ].filter(Boolean);
      return { kind: "processor_fee", title: "Automático: comisión del procesador", detail: `${parts.join(": ")}.`, href: null, linkLabel: null };
    }
    case "meta_ads": {
      const days = Number(ref.days_with_data);
      const account = typeof ref.ad_account_id === "string" ? ref.ad_account_id : null;
      const parts = [
        `Pauta de Meta${account ? ` (cuenta ${account})` : ""}${month ? ` de ${month}` : ""}`,
        Number.isFinite(days) && ref.days_with_data !== undefined ? `${plural(days, "día", "días")} con datos` : null,
      ].filter(Boolean);
      return { kind: "meta_ads", title: "Automático: pauta de Meta", detail: `${parts.join(": ")}.`, href: null, linkLabel: null };
    }
    case "adjustment":
      return {
        kind: "adjustment",
        title: "Ajuste",
        detail: lookups.adjustedConcept ? `Ajusta «${lookups.adjustedConcept}».` : "Ajusta otro gasto.",
        href: input.adjusts_expense_id ? `/dashboard/finanzas/gastos/${input.adjusts_expense_id}` : null,
        linkLabel: input.adjusts_expense_id ? "Ver el gasto original" : null,
      };
    case "commission_payout": {
      const count = Number(ref.count);
      return {
        kind: "commission_payout",
        title: "Liquidación de comisiones",
        detail: Number.isFinite(count) && ref.count !== undefined ? `Suma ${plural(count, "comisión", "comisiones")}.` : "Suma las comisiones de una liquidación.",
        href: null,
        linkLabel: null,
      };
    }
    default:
      return { kind: "unknown", title: input.origin || "—", detail: null, href: null, linkLabel: null };
  }
}

// ── Diferencia de un automático ya pagado ──────────────────────────────

/** «El monto cambió después de pagado: diferencia −USD 4,20», o null si no hay una diferencia sin resolver. */
export function driftNotice(input: { auto_drift_amount?: unknown; auto_drift_resolved_at?: string | null }): string | null {
  if (input.auto_drift_amount === null || input.auto_drift_amount === undefined) return null;
  if (input.auto_drift_resolved_at) return null;
  const cents = toCents(input.auto_drift_amount);
  if (cents === 0) return null;
  return `El monto cambió después de pagado: diferencia ${formatUsd(cents)}`;
}

/**
 * Qué significa la diferencia de un automático ya pagado, en palabras: con signo positivo el monto subió después de
 * pagar (falta pagar esa diferencia); con signo negativo bajó (se pagó de más). `cents` es la diferencia con su signo.
 */
export function driftExplanation(cents: number): string {
  const amount = formatUsd(Math.abs(cents));
  if (cents > 0) return `El monto subió después de pagado: faltan ${amount} por pagar.`;
  if (cents < 0) return `El monto bajó después de pagado: se pagaron ${amount} de más.`;
  return "No hay diferencia.";
}

// ── CSV ────────────────────────────────────────────────────────────────

/** El link del CSV: la misma query de la lista (sin la página). */
export function exportHref(filters: ExpenseFilters): string {
  const qs = serializeExpenseFilters({ ...filters, page: 1 });
  return `/api/v1/expenses/export${qs ? `?${qs}` : ""}`;
}

/** Si el filtro tiene más filas que el tope del CSV, el aviso que se muestra antes de bajarlo. */
export function exportWarning(total: number): string | null {
  if (total <= EXPENSES_CSV_LIMIT) return null;
  const limit = EXPENSES_CSV_LIMIT.toLocaleString("es-AR");
  return `Este filtro tiene ${total.toLocaleString("es-AR")} gastos y el CSV trae como máximo ${limit}. Acotá el filtro para bajar todo.`;
}

// ── Categorías en un selector ──────────────────────────────────────────

export interface CategoryOptionGroup {
  group: CategoryGroup;
  label: string;
  options: Array<{ key: string; name: string }>;
}

/**
 * Las categorías agrupadas por su grupo, para un `<select>` con `<optgroup>`. Solo las activas, más
 * `keepKey` (la categoría que el gasto ya tiene, aunque esté archivada).
 */
export function categoryOptionGroups(categories: readonly ExpenseCategory[], keepKey?: string | null): CategoryOptionGroup[] {
  const out: CategoryOptionGroup[] = [];
  for (const group of CATEGORY_GROUPS) {
    const options = categories
      .filter((c) => c.group === group && (!c.archived_at || c.key === keepKey))
      .map((c) => ({ key: c.key, name: c.archived_at ? `${c.name} (archivada)` : c.name }));
    if (options.length > 0) out.push({ group, label: CATEGORY_GROUP_LABELS[group], options });
  }
  return out;
}

/** ¿Es una imagen? (para elegir el ícono del comprobante por su nombre). */
export function receiptKind(name: string | null | undefined): "pdf" | "image" | "file" {
  const n = (name ?? "").toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp|heic)$/.test(n)) return "image";
  return "file";
}

/** El control rápido al elegir un comprobante (el servidor lo vuelve a validar por los bytes). */
export function receiptPickError(file: { size: number }): string | null {
  if (file.size === 0) return "El archivo está vacío";
  if (file.size > RECEIPT_MAX_BYTES) return "El comprobante pesa más de 10 MB";
  return null;
}
