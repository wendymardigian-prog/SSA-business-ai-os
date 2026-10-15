/**
 * El formulario de un gasto (GF7): el borrador que escribe la persona, cómo se lee el monto que tipea, qué
 * campos quedan bloqueados según el estado y el origen, y cómo se arma lo que se manda a las Server Actions.
 * Puro: el componente solo lo compone, y el servidor vuelve a validar todo con las reglas de `expense-rules`.
 */
import { isDateOnly, type CivilDate } from "./dates";
import { activeCategories, findCategory, type ExpenseCategory } from "./categories";
import { CONCEPT_MAX, HIGH_AMOUNT_CENTS, NOTES_MAX, duplicateDraft, type ExpenseRowLite } from "./expense-rules";
import { isAutoOrigin } from "./expense-status";

export const MAX_AMOUNT_CENTS = 999_999_999_999;

export type AmountParse = { kind: "empty" } | { kind: "ok"; cents: number } | { kind: "invalid"; error: string };

/**
 * Lee el monto como lo escribe la gente: `1240`, `1240,5`, `1.240,50`, `1,240.50`, `USD 12.500`.
 * Con un solo separador y exactamente tres cifras detrás ("12.500", "1,240") es de miles: nadie escribe
 * milésimas de dólar. Con dos cifras o menos es decimal. Mezclar ambos: el último es el decimal.
 */
export function parseAmountText(text: string, options: { allowNegative?: boolean } = {}): AmountParse {
  let t = text.replace(/usd|us\$|\$/gi, "").replace(/[\s ]/g, "");
  if (t === "") return { kind: "empty" };
  let negative = false;
  if (t.startsWith("-") || t.startsWith("−")) {
    negative = true;
    t = t.slice(1);
  }
  if (negative && !options.allowNegative) return { kind: "invalid", error: "El monto no puede ser negativo" };
  if (!/^\d[\d.,]*$/.test(t)) return { kind: "invalid", error: "Escribí el monto con números, por ejemplo 1240,50" };

  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  const dots = (t.match(/\./g) ?? []).length;
  const commas = (t.match(/,/g) ?? []).length;

  let whole: string;
  let frac = "";
  const thousandsOk = (s: string, sep: string) => s.split(sep).every((g, i) => (i === 0 ? /^\d{1,3}$/.test(g) : /^\d{3}$/.test(g)));

  if (dots > 0 && commas > 0) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    const idx = t.lastIndexOf(decimalSep);
    const intPart = t.slice(0, idx);
    frac = t.slice(idx + 1);
    if (intPart.includes(decimalSep) || !thousandsOk(intPart, thousandsSep)) return { kind: "invalid", error: "No entiendo ese monto: revisá los puntos y las comas" };
    whole = intPart.split(thousandsSep).join("");
  } else if (dots > 0 || commas > 0) {
    const sep = dots > 0 ? "." : ",";
    const count = dots > 0 ? dots : commas;
    if (count > 1) {
      if (!thousandsOk(t, sep)) return { kind: "invalid", error: "No entiendo ese monto: revisá los puntos y las comas" };
      whole = t.split(sep).join("");
    } else {
      const idx = t.indexOf(sep);
      const left = t.slice(0, idx);
      const right = t.slice(idx + 1);
      if (right.length === 3 && left !== "0" && /^\d{1,3}$/.test(left)) whole = left + right;
      else {
        whole = left;
        frac = right;
      }
    }
  } else {
    whole = t;
  }

  if (!/^\d+$/.test(whole) || (frac !== "" && !/^\d{1,2}$/.test(frac))) return { kind: "invalid", error: "El monto lleva hasta dos decimales" };
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return { kind: "invalid", error: "Ese monto es demasiado grande" };
  return { kind: "ok", cents: negative ? -cents : cents };
}

/** El monto de la base como se muestra en el campo: `1240,50`. */
export function amountToText(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return "";
  return n.toFixed(2).replace(".", ",").replace(/,00$/, "");
}

export const isHighAmountCents = (cents: number): boolean => cents >= HIGH_AMOUNT_CENTS;

// ── El borrador ─────────────────────────────────────────────────────────

export interface ExpenseDraft {
  concept: string;
  vendorId: string | null;
  categoryKey: string;
  amountText: string;
  amountToConfirm: boolean;
  scheduledDate: string;
  responsibleId: string | null;
  notes: string;
  paid: boolean;
  paidDate: string;
}

/** El alta en blanco: hoy como fecha y la primera categoría activa como punto de partida. */
export function emptyDraft(todayLocal: CivilDate, categories: readonly ExpenseCategory[]): ExpenseDraft {
  return {
    concept: "",
    vendorId: null,
    categoryKey: activeCategories(categories)[0]?.key ?? "",
    amountText: "",
    amountToConfirm: false,
    scheduledDate: todayLocal,
    responsibleId: null,
    notes: "",
    paid: false,
    paidDate: todayLocal,
  };
}

/** Duplicar: lo que copia `duplicateDraft` y la fecha vacía (obligatoria), nunca el comprobante. */
export function draftFromDuplicate(existing: ExpenseRowLite, todayLocal: CivilDate, categories: readonly ExpenseCategory[]): ExpenseDraft {
  const copy = duplicateDraft(existing);
  const category = findCategory(categories, copy.categoryKey);
  const usable = category && !category.archived_at ? category.key : (activeCategories(categories)[0]?.key ?? "");
  return {
    concept: copy.concept,
    vendorId: copy.vendorId ?? null,
    categoryKey: usable,
    amountText: amountToText(copy.amount),
    amountToConfirm: existing.status === "por_revisar",
    scheduledDate: "",
    responsibleId: copy.responsibleId ?? null,
    notes: copy.notes ?? "",
    paid: false,
    paidDate: todayLocal,
  };
}

/** Editar: los valores del gasto tal cual están. */
export function draftFromExpense(row: ExpenseRowLite, todayLocal: CivilDate): ExpenseDraft {
  return {
    concept: row.concept,
    vendorId: row.vendor_id,
    categoryKey: row.category_key,
    amountText: amountToText(row.amount),
    amountToConfirm: false,
    scheduledDate: row.scheduled_date,
    responsibleId: row.responsible_id,
    notes: row.notes ?? "",
    paid: false,
    paidDate: todayLocal,
  };
}

// ── Qué se puede cambiar ───────────────────────────────────────────────

export interface FieldLocks {
  concept: boolean;
  vendor: boolean;
  amount: boolean;
  scheduledDate: boolean;
  /** Por qué el monto está bloqueado (para mostrarlo debajo). */
  amountReason: string | null;
  conceptReason: string | null;
  vendorReason: string | null;
  dateReason: string | null;
}

const NONE: FieldLocks = { concept: false, vendor: false, amount: false, scheduledDate: false, amountReason: null, conceptReason: null, vendorReason: null, dateReason: null };

/**
 * Qué campos no se pueden tocar al editar (el mismo criterio que `planUpdateExpense`, con el mensaje a la
 * vista): un pagado no cambia monto ni fecha, un automático sin pagar no cambia monto ni concepto, y una
 * liquidación de comisiones no cambia monto ni persona.
 */
export function fieldLocks(row: Pick<ExpenseRowLite, "status" | "origin"> | null): FieldLocks {
  if (!row) return NONE;
  const locks: FieldLocks = { ...NONE };
  if (row.status === "pagado") {
    locks.amount = true;
    locks.scheduledDate = true;
    locks.amountReason = "Revertí el pago primero para cambiar el monto.";
    locks.dateReason = "Revertí el pago primero para cambiar la fecha.";
  }
  if (isAutoOrigin(row.origin) && row.status !== "pagado") {
    locks.amount = true;
    locks.concept = true;
    locks.amountReason = "Este monto lo calcula el sistema todos los días. Se congela cuando lo marcás pagado.";
    locks.conceptReason = "El concepto de un gasto automático lo arma el sistema.";
  }
  if (row.origin === "commission_payout") {
    locks.amount = true;
    locks.vendor = true;
    locks.amountReason = "El monto de una liquidación es la suma de sus comisiones: anulala y generala de nuevo.";
    locks.vendorReason = "No se cambia la persona de una liquidación: anulala y generala de nuevo.";
  }
  return locks;
}

// ── Validar y armar lo que se manda ────────────────────────────────────

export interface DraftContext {
  mode: "create" | "edit";
  todayLocal: CivilDate;
  categories: readonly ExpenseCategory[];
  row?: Pick<ExpenseRowLite, "status" | "origin" | "category_key"> | null;
}

export type DraftCheck = { ok: true; amountCents: number | null } | { ok: false; error: string; field: "concept" | "category" | "amount" | "date" | "paidDate" };

export function validateDraft(draft: ExpenseDraft, ctx: DraftContext): DraftCheck {
  const concept = draft.concept.trim();
  if (!concept) return { ok: false, field: "concept", error: "Poné un concepto" };
  if (concept.length > CONCEPT_MAX) return { ok: false, field: "concept", error: `El concepto puede tener hasta ${CONCEPT_MAX} caracteres` };
  if (draft.notes.length > NOTES_MAX) return { ok: false, field: "concept", error: `Las notas pueden tener hasta ${NOTES_MAX} caracteres` };

  const category = findCategory(ctx.categories, draft.categoryKey);
  const keepsOwn = ctx.mode === "edit" && ctx.row?.category_key === draft.categoryKey;
  if (!category || (category.archived_at && !keepsOwn)) return { ok: false, field: "category", error: "Elegí una categoría" };
  if (!isDateOnly(draft.scheduledDate)) return { ok: false, field: "date", error: "Elegí la fecha programada" };

  const locks = ctx.mode === "edit" ? fieldLocks(ctx.row ?? null) : NONE;
  const isAdjustment = ctx.mode === "edit" && ctx.row?.origin === "adjustment";
  let amountCents: number | null = null;
  if (!locks.amount) {
    const parsed = parseAmountText(draft.amountText, { allowNegative: isAdjustment });
    if (parsed.kind === "invalid") return { ok: false, field: "amount", error: parsed.error };
    if (parsed.kind === "ok") amountCents = parsed.cents;
    const skipsAmount = ctx.mode === "create" ? draft.amountToConfirm : ctx.row?.status === "por_revisar";
    if (!skipsAmount && (amountCents === null || amountCents === 0)) {
      return { ok: false, field: "amount", error: ctx.mode === "create" ? "Cargá el monto (o marcá «Monto a confirmar»)" : "El monto tiene que ser mayor que cero" };
    }
    if (amountCents !== null && amountCents < 0 && !isAdjustment) return { ok: false, field: "amount", error: "El monto no puede ser negativo" };
  }

  if (ctx.mode === "create" && draft.paid) {
    if (draft.amountToConfirm) return { ok: false, field: "amount", error: "Un gasto sin monto no se puede marcar como pagado" };
    if (!isDateOnly(draft.paidDate)) return { ok: false, field: "paidDate", error: "Elegí la fecha de pago" };
    if (draft.paidDate > ctx.todayLocal) return { ok: false, field: "paidDate", error: "La fecha de pago no puede ser futura" };
  }
  return { ok: true, amountCents };
}

/** Lo que recibe `createExpense`. El monto va en dólares (número) para que el servidor lo pase a céntimos. */
export function toCreateInput(draft: ExpenseDraft, amountCents: number | null) {
  return {
    concept: draft.concept.trim(),
    vendorId: draft.vendorId,
    categoryKey: draft.categoryKey,
    amount: draft.amountToConfirm || amountCents === null ? null : amountCents / 100,
    amountToConfirm: draft.amountToConfirm,
    scheduledDate: draft.scheduledDate,
    responsibleId: draft.responsibleId,
    notes: draft.notes.trim() === "" ? null : draft.notes,
    paid: draft.paid,
    paidDate: draft.paid ? draft.paidDate : null,
  };
}

/**
 * Lo que recibe `updateExpense`. Un monto bloqueado o vacío no se manda (el servidor conserva el que está), y la
 * fecha de un pagado viaja igual a la guardada.
 */
export function toUpdateInput(draft: ExpenseDraft, amountCents: number | null, row: Pick<ExpenseRowLite, "scheduled_date">) {
  return {
    concept: draft.concept.trim(),
    vendorId: draft.vendorId,
    categoryKey: draft.categoryKey,
    ...(amountCents === null ? {} : { amount: amountCents / 100 }),
    scheduledDate: draft.scheduledDate || row.scheduled_date,
    responsibleId: draft.responsibleId,
    notes: draft.notes.trim() === "" ? null : draft.notes,
  };
}
