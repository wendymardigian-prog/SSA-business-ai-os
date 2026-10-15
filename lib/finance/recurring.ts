/**
 * Plantillas de gastos recurrentes (GF16). Puro: el estado derivado, el equivalente mensual, la frecuencia en
 * palabras y la validación del alta/edición. Las Server Actions solo llaman y escriben.
 *
 * La plata va en CÉNTIMOS enteros (`toCents`/`fromCents`) y las fechas son civiles (`AAAA-MM-DD`) en la zona
 * del workspace: `todayLocal` lo calcula quien llama.
 *
 * `RecurringTemplateRow` es la fila de `recurring_expenses` (00225) tal cual; `RecurrenceTemplate`, el
 * subconjunto que entiende el motor (`recurrence.ts`).
 */
import { z } from "zod";
import { fromCents, toCents } from "@/lib/sales/money";
import { CATEGORY_KEY_RE } from "./categories";
import type { RuleResult } from "./expense-rules";
import {
  firstOccurrenceOnOrAfter,
  isValidCivil,
  RECURRENCE_FREQUENCIES,
  validateRecurrenceRule,
  type CivilDate,
  type RecurrenceRule,
  type RecurrenceTemplate,
} from "./recurrence";

export const RECURRING_CONCEPT_MAX = 200;
export const RECURRING_NOTES_MAX = 2000;
export const LEAD_DAYS_MAX = 60;
/** numeric(12,2): hasta 9.999.999.999,99. */
const MAX_AMOUNT_CENTS = 999_999_999_999;

export type RecurringStatus = "active" | "paused" | "finished";

export const RECURRING_STATUS_LABELS: Record<RecurringStatus, string> = {
  active: "Activa",
  paused: "Pausada",
  finished: "Terminada",
};

/** La fila de `recurring_expenses` (lo que lee el motor y la pantalla). `amount` llega como número o texto. */
export interface RecurringTemplateRow {
  id?: string;
  concept: string;
  vendor_id: string | null;
  category_key: string;
  amount_type: "fixed" | "variable";
  amount: unknown;
  charge_mode: "automatic" | "manual";
  frequency: "weekly" | "biweekly" | "monthly" | "yearly";
  weekly_day: number | null;
  weekly_interval: number | null;
  monthly_day: number | null;
  yearly_month: number | null;
  yearly_day: number | null;
  start_date: CivilDate;
  end_date: CivilDate | null;
  lead_days: number;
  is_active: boolean;
  generation_anchor: CivilDate;
  responsible_id: string | null;
  notes: string | null;
}

/** La regla de una fila, o null si las columnas de la frecuencia no están completas (fila corrupta). */
export function ruleFromRow(row: Pick<RecurringTemplateRow, "frequency" | "weekly_day" | "weekly_interval" | "monthly_day" | "yearly_month" | "yearly_day">): RecurrenceRule | null {
  const candidate =
    row.frequency === "weekly"
      ? { frequency: "weekly", weeklyDay: row.weekly_day, weeklyInterval: row.weekly_interval }
      : row.frequency === "monthly"
        ? { frequency: "monthly", monthlyDay: row.monthly_day }
        : row.frequency === "yearly"
          ? { frequency: "yearly", yearlyMonth: row.yearly_month, yearlyDay: row.yearly_day }
          : { frequency: row.frequency };
  const checked = validateRecurrenceRule(candidate);
  return checked.ok ? checked.rule : null;
}

/** Lo que entiende el motor, o null si la fila no tiene una regla válida. */
export function templateForEngine(row: Pick<RecurringTemplateRow, "frequency" | "weekly_day" | "weekly_interval" | "monthly_day" | "yearly_month" | "yearly_day" | "start_date" | "end_date">): RecurrenceTemplate | null {
  const rule = ruleFromRow(row);
  return rule ? { rule, startDate: row.start_date, endDate: row.end_date } : null;
}

/**
 * Estado derivado: Pausada si `is_active = false`; Terminada si tiene fin y ya no le queda ninguna fecha de
 * pago >= hoy; si no, Activa.
 */
export function recurringStatus(
  template: Pick<RecurringTemplateRow, "is_active" | "frequency" | "weekly_day" | "weekly_interval" | "monthly_day" | "yearly_month" | "yearly_day" | "start_date" | "end_date">,
  todayLocal: CivilDate,
): RecurringStatus {
  if (!template.is_active) return "paused";
  if (template.end_date) {
    const engine = templateForEngine(template);
    if (engine && firstOccurrenceOnOrAfter(engine, todayLocal) === null) return "finished";
  }
  return "active";
}

/**
 * Lo que pesa la plantilla en un mes, en CÉNTIMOS: semanal × 52/12 / intervalo, quincenal × 2, mensual × 1,
 * anual / 12. Se redondea una sola vez al céntimo entero (USD 10 semanal cada 1 semana = 4333). Una variable
 * sin monto estimado vale 0.
 */
export function monthlyEquivalent(template: Pick<RecurringTemplateRow, "amount" | "frequency" | "weekly_interval">): number {
  const cents = toCents(template.amount);
  if (!(cents > 0)) return 0;
  switch (template.frequency) {
    case "weekly": {
      const interval = Math.max(1, Math.trunc(Number(template.weekly_interval)) || 1);
      return Math.round((cents * 52) / (12 * interval));
    }
    case "biweekly":
      return cents * 2;
    case "monthly":
      return cents;
    case "yearly":
      return Math.round(cents / 12);
    default:
      return 0;
  }
}

// ── La frecuencia en palabras ──────────────────────────────────────────

const WEEKDAY_PLURAL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * «Mensual, el día 5» · «Cada 2 semanas, los lunes» · «Quincenal: 15 y último día» · «Anual, el 15 de marzo».
 * Un día que no existe en todos los meses lo aclara («Mensual, el día 31 (o el último del mes)»).
 */
export function describeFrequency(rule: RecurrenceRule): string {
  switch (rule.frequency) {
    case "weekly": {
      const day = WEEKDAY_PLURAL[rule.weeklyDay] ?? "";
      return rule.weeklyInterval === 1 ? `Semanal, los ${day}` : `Cada ${rule.weeklyInterval} semanas, los ${day}`;
    }
    case "biweekly":
      return "Quincenal: 15 y último día";
    case "monthly":
      return rule.monthlyDay > 28 ? `Mensual, el día ${rule.monthlyDay} (o el último del mes)` : `Mensual, el día ${rule.monthlyDay}`;
    case "yearly": {
      const base = `Anual, el ${rule.yearlyDay} de ${MONTH_NAMES[rule.yearlyMonth - 1] ?? ""}`;
      return rule.yearlyMonth === 2 && rule.yearlyDay === 29 ? `${base} (el 28 en los años no bisiestos)` : base;
    }
  }
}

// ── Alta / edición ─────────────────────────────────────────────────────

const emptyToNull = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

const optionalInt = z.number({ error: "Tiene que ser un número" }).int("Tiene que ser un número entero").nullish();

/**
 * Lo que manda el formulario. Los campos de frecuencia que no corresponden se ignoran (no se guardan). El
 * monto viaja en dólares, como lo escribe la persona (número o texto).
 */
export const recurringTemplateSchema = z
  .object({
    concept: z
      .string({ error: "Poné un concepto" })
      .trim()
      .min(1, "Poné un concepto")
      .max(RECURRING_CONCEPT_MAX, `El concepto puede tener hasta ${RECURRING_CONCEPT_MAX} caracteres`),
    vendorId: z.string().nullish(),
    categoryKey: z.string({ error: "Elegí una categoría" }).regex(CATEGORY_KEY_RE, "Elegí una categoría"),
    amountType: z.enum(["fixed", "variable"], { error: "Elegí si el monto es fijo o variable" }),
    amount: z.unknown().optional(),
    chargeMode: z.enum(["automatic", "manual"], { error: "Elegí cómo se cobra" }),
    frequency: z.enum(RECURRENCE_FREQUENCIES, { error: "Elegí una frecuencia" }),
    weeklyDay: optionalInt,
    weeklyInterval: optionalInt,
    monthlyDay: optionalInt,
    yearlyMonth: optionalInt,
    yearlyDay: optionalInt,
    startDate: z.string({ error: "Poné la fecha de inicio" }),
    endDate: z.string().nullish(),
    leadDays: optionalInt,
    responsibleId: z.string().nullish(),
    notes: z.string().max(RECURRING_NOTES_MAX, `Las notas pueden tener hasta ${RECURRING_NOTES_MAX} caracteres`).nullish(),
  })
  .superRefine((v, ctx) => {
    const fail = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });

    // La regla: lo que pide cada frecuencia.
    const rule = validateRecurrenceRule(
      v.frequency === "weekly"
        ? { frequency: "weekly", weeklyDay: v.weeklyDay ?? undefined, weeklyInterval: v.weeklyInterval ?? undefined }
        : v.frequency === "monthly"
          ? { frequency: "monthly", monthlyDay: v.monthlyDay ?? undefined }
          : v.frequency === "yearly"
            ? { frequency: "yearly", yearlyMonth: v.yearlyMonth ?? undefined, yearlyDay: v.yearlyDay ?? undefined }
            : { frequency: "biweekly" },
    );
    if (!rule.ok) fail(rule.error, "frequency");

    // Fechas.
    if (!isValidCivil(v.startDate)) fail("La fecha de inicio no es válida", "startDate");
    const endDate = emptyToNull(v.endDate);
    if (endDate !== null) {
      if (!isValidCivil(endDate)) fail("La fecha de fin no es válida", "endDate");
      else if (isValidCivil(v.startDate) && endDate < v.startDate) fail("La fecha de fin no puede ser anterior al inicio", "endDate");
    }

    // Monto: fijo pide monto > 0; variable puede no tener (o tener un estimado > 0).
    const raw = v.amount;
    const hasAmount = raw !== undefined && raw !== null && !(typeof raw === "string" && raw.trim() === "");
    const cents = hasAmount ? toCents(raw) : 0;
    if (v.amountType === "fixed" && !(cents > 0)) fail("Un gasto fijo necesita un monto mayor que cero (o elegí «variable»)", "amount");
    else if (v.amountType === "variable" && hasAmount && !(cents > 0)) fail("El monto estimado tiene que ser mayor que cero (o dejalo vacío)", "amount");
    else if (cents > MAX_AMOUNT_CENTS) fail("El monto es demasiado grande", "amount");

    // Anticipación: 0 a 60. Con débito automático no se mira: queda en 0.
    if (v.chargeMode === "manual") {
      const lead = v.leadDays ?? 0;
      if (lead < 0 || lead > LEAD_DAYS_MAX) fail(`«Crear con anticipación» va de 0 a ${LEAD_DAYS_MAX} días`, "leadDays");
    }
  });

export type RecurringTemplateInput = z.input<typeof recurringTemplateSchema>;

/** La fila lista para insertar en `recurring_expenses` (falta `workspace_id` y `created_by`, que pone quien llama). */
export interface NewRecurringRow {
  concept: string;
  vendor_id: string | null;
  category_key: string;
  amount_type: "fixed" | "variable";
  amount: number | null;
  currency: "USD";
  charge_mode: "automatic" | "manual";
  frequency: RecurringTemplateRow["frequency"];
  weekly_day: number | null;
  weekly_interval: number | null;
  monthly_day: number | null;
  yearly_month: number | null;
  yearly_day: number | null;
  start_date: CivilDate;
  end_date: CivilDate | null;
  lead_days: number;
  is_active: true;
  generation_anchor: CivilDate;
  responsible_id: string | null;
  notes: string | null;
}

/**
 * Valida lo que manda el formulario y arma la fila: los campos de frecuencia que no corresponden quedan en
 * null (el CHECK de la base los exige), con débito automático `lead_days` es 0 aunque el cliente mande otro
 * valor, y `generation_anchor` es hoy (la plantilla nace generando desde hoy; al editar, quien llama decide si
 * el cambio la reinicia).
 */
export function normalizeTemplate(input: unknown, todayLocal: CivilDate): RuleResult<{ row: NewRecurringRow }> {
  if (!isValidCivil(todayLocal)) return { ok: false, error: "No se pudo determinar la fecha de hoy" };
  const parsed = recurringTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Los datos de la plantilla no son válidos" };
  const v = parsed.data;

  const hasAmount = v.amount !== undefined && v.amount !== null && !(typeof v.amount === "string" && v.amount.trim() === "");
  const amount = hasAmount ? fromCents(toCents(v.amount)) : null;

  return {
    ok: true,
    row: {
      concept: v.concept,
      vendor_id: emptyToNull(v.vendorId),
      category_key: v.categoryKey,
      amount_type: v.amountType,
      amount,
      currency: "USD",
      charge_mode: v.chargeMode,
      frequency: v.frequency,
      weekly_day: v.frequency === "weekly" ? (v.weeklyDay ?? null) : null,
      weekly_interval: v.frequency === "weekly" ? (v.weeklyInterval ?? null) : null,
      monthly_day: v.frequency === "monthly" ? (v.monthlyDay ?? null) : null,
      yearly_month: v.frequency === "yearly" ? (v.yearlyMonth ?? null) : null,
      yearly_day: v.frequency === "yearly" ? (v.yearlyDay ?? null) : null,
      start_date: v.startDate,
      end_date: emptyToNull(v.endDate),
      lead_days: v.chargeMode === "automatic" ? 0 : (v.leadDays ?? 0),
      is_active: true,
      generation_anchor: todayLocal,
      responsible_id: emptyToNull(v.responsibleId),
      notes: emptyToNull(v.notes),
    },
  };
}
