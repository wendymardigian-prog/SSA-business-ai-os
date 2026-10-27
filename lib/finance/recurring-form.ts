/**
 * El formulario de una plantilla recurrente (GF16). PURO: el borrador, cómo se arma lo que viaja a la Server Action,
 * el control rápido de lo evidente y la vista previa de las próximas fechas de pago. El servidor vuelve a validar
 * todo con `normalizeTemplate`, la MISMA función que usa este control: lo que acá se acepta, allá también.
 *
 * Los campos numéricos viajan como texto (`"5"`, `""`) para que el campo se pueda vaciar mientras se escribe.
 */
import { activeCategories, type ExpenseCategory } from "./categories";
import { parseAmountText } from "./expense-form";
import { addDaysCivil, firstOccurrenceOnOrAfter, isValidCivil, nextOccurrence, validateRecurrenceRule, type CivilDate, type RecurrenceTemplate } from "./recurrence";
import { LEAD_DAYS_MAX, normalizeTemplate, type RecurringTemplateInput, type RecurringTemplateRow } from "./recurring";
import { weekdayOf } from "./dates";
import { fromCents, toCents } from "@/lib/shared/money";

export type RecurringFrequencyValue = RecurringTemplateRow["frequency"];

export interface RecurringDraft {
  /** Con id, se edita; sin id, se crea. */
  id?: string;
  /** Para avisar si alguien la cambió mientras se editaba. */
  updatedAt?: string;
  concept: string;
  vendorId: string | null;
  categoryKey: string;
  amountType: "fixed" | "variable";
  /** En dólares, como lo escribe la persona. Vacío con monto variable = sin estimado. */
  amountText: string;
  chargeMode: "automatic" | "manual";
  frequency: RecurringFrequencyValue;
  /** 0 = domingo … 6 = sábado. */
  weeklyDay: number;
  weeklyInterval: string;
  monthlyDay: string;
  yearlyMonth: number;
  yearlyDay: string;
  startDate: string;
  endDate: string;
  leadDays: string;
  responsibleId: string | null;
  notes: string;
}

/** La categoría con la que arranca una plantilla nueva: «Software y suscripciones» si está activa; si no, la primera activa. */
export function defaultRecurringCategory(categories: readonly ExpenseCategory[]): string {
  const active = activeCategories(categories);
  return (active.find((c) => c.key === "software") ?? active[0])?.key ?? "other";
}

export function emptyRecurringDraft(todayLocal: CivilDate, categories: readonly ExpenseCategory[]): RecurringDraft {
  const day = String(Number(todayLocal.slice(8, 10)) || 1);
  return {
    concept: "",
    vendorId: null,
    categoryKey: defaultRecurringCategory(categories),
    amountType: "fixed",
    amountText: "",
    chargeMode: "manual",
    frequency: "monthly",
    weeklyDay: isValidCivil(todayLocal) ? weekdayOf(todayLocal) : 1,
    weeklyInterval: "1",
    monthlyDay: day,
    yearlyMonth: Number(todayLocal.slice(5, 7)) || 1,
    yearlyDay: day,
    startDate: todayLocal,
    endDate: "",
    leadDays: "0",
    responsibleId: null,
    notes: "",
  };
}

const numText = (v: number | null | undefined, fallback: string) => (v === null || v === undefined ? fallback : String(v));

/** `36` → `36,00` (coma decimal, como se escribe en este sistema). */
function amountToText(amount: unknown): string {
  if (amount === null || amount === undefined || amount === "") return "";
  const cents = toCents(amount);
  return cents > 0 ? fromCents(cents).toFixed(2).replace(".", ",") : "";
}

export function draftFromRow(row: RecurringTemplateRow, id: string, updatedAt: string): RecurringDraft {
  const base = emptyRecurringDraft(row.start_date, []);
  return {
    ...base,
    id,
    updatedAt,
    concept: row.concept,
    vendorId: row.vendor_id,
    categoryKey: row.category_key,
    amountType: row.amount_type,
    amountText: amountToText(row.amount),
    chargeMode: row.charge_mode,
    frequency: row.frequency,
    weeklyDay: row.weekly_day ?? base.weeklyDay,
    weeklyInterval: numText(row.weekly_interval, "1"),
    monthlyDay: numText(row.monthly_day, base.monthlyDay),
    yearlyMonth: row.yearly_month ?? base.yearlyMonth,
    yearlyDay: numText(row.yearly_day, base.yearlyDay),
    startDate: row.start_date,
    endDate: row.end_date ?? "",
    leadDays: numText(row.lead_days, "0"),
    responsibleId: row.responsible_id,
    notes: row.notes ?? "",
  };
}

const toInt = (text: string): number | undefined => {
  const t = text.trim();
  if (t === "" || !/^-?\d+$/.test(t)) return undefined;
  return Number(t);
};

export type BuiltInput = { ok: true; input: RecurringTemplateInput } | { ok: false; error: string };

/** Lo que viaja a `createRecurringTemplate` / `updateRecurringTemplate`. El monto se pasa a dólares exactos (por céntimos). */
export function buildRecurringInput(draft: RecurringDraft): BuiltInput {
  const parsed = parseAmountText(draft.amountText);
  if (parsed.kind === "invalid") return { ok: false, error: parsed.error };
  const amount = parsed.kind === "ok" ? fromCents(parsed.cents) : undefined;
  const f = draft.frequency;
  return {
    ok: true,
    input: {
      concept: draft.concept,
      vendorId: draft.vendorId,
      categoryKey: draft.categoryKey,
      amountType: draft.amountType,
      amount,
      chargeMode: draft.chargeMode,
      frequency: f,
      weeklyDay: f === "weekly" ? draft.weeklyDay : null,
      weeklyInterval: f === "weekly" ? toInt(draft.weeklyInterval) : null,
      monthlyDay: f === "monthly" ? toInt(draft.monthlyDay) : null,
      yearlyMonth: f === "yearly" ? draft.yearlyMonth : null,
      yearlyDay: f === "yearly" ? toInt(draft.yearlyDay) : null,
      startDate: draft.startDate,
      endDate: draft.endDate.trim() === "" ? null : draft.endDate,
      leadDays: draft.chargeMode === "manual" ? (toInt(draft.leadDays) ?? 0) : 0,
      responsibleId: draft.responsibleId,
      notes: draft.notes.trim() === "" ? null : draft.notes,
    },
  };
}

/** El primer error de lo evidente, o null si se puede mandar al servidor (que vuelve a validar). */
export function recurringDraftError(draft: RecurringDraft, todayLocal: CivilDate): string | null {
  const built = buildRecurringInput(draft);
  if (!built.ok) return built.error;
  const checked = normalizeTemplate(built.input, todayLocal);
  return checked.ok ? null : checked.error;
}

/** La plantilla que entiende el motor, o null si el borrador todavía no tiene una regla válida. */
function engineOf(draft: RecurringDraft): RecurrenceTemplate | null {
  const f = draft.frequency;
  const rule = validateRecurrenceRule(
    f === "weekly"
      ? { frequency: "weekly", weeklyDay: draft.weeklyDay, weeklyInterval: toInt(draft.weeklyInterval) }
      : f === "monthly"
        ? { frequency: "monthly", monthlyDay: toInt(draft.monthlyDay) }
        : f === "yearly"
          ? { frequency: "yearly", yearlyMonth: draft.yearlyMonth, yearlyDay: toInt(draft.yearlyDay) }
          : { frequency: "biweekly" },
  );
  if (!rule.ok || !isValidCivil(draft.startDate)) return null;
  const endDate = draft.endDate.trim() === "" ? null : draft.endDate;
  if (endDate !== null && !isValidCivil(endDate)) return null;
  return { rule: rule.rule, startDate: draft.startDate, endDate };
}

export interface DatePreview {
  /** La fecha de pago. */
  date: CivilDate;
  /** Cuándo se crea el gasto (solo si es a mano y con anticipación); si no, null. */
  createdOn: CivilDate | null;
}

/** Las próximas `count` fechas de pago desde hoy, para que la persona vea qué hace la regla antes de guardar. */
export function previewPaymentDates(draft: RecurringDraft, todayLocal: CivilDate, count = 3): DatePreview[] {
  const engine = engineOf(draft);
  if (!engine || !isValidCivil(todayLocal)) return [];
  const lead = draft.chargeMode === "manual" ? Math.min(LEAD_DAYS_MAX, Math.max(0, toInt(draft.leadDays) ?? 0)) : 0;
  const out: DatePreview[] = [];
  let date = firstOccurrenceOnOrAfter(engine, todayLocal);
  while (date && out.length < count) {
    out.push({ date, createdOn: lead > 0 ? addDaysCivil(date, -lead) : null });
    date = nextOccurrence(engine, date);
  }
  return out;
}
