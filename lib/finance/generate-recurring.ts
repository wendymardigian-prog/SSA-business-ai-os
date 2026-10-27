/**
 * Generación diaria de gastos recurrentes (GF17): SOLO la parte que decide, pura. Lo que escribe (el insert con
 * `ON CONFLICT (recurring_expense_id, scheduled_date) DO NOTHING`, el tope por corrida, el `audit_log`) vive en
 * el handler `finance_daily`. Nada acá toca la base.
 *
 *   Plantilla                    Estado al nacer                         paid_date    Monto
 *   Variable (cualquier cobro)   Por revisar                             null         0
 *   Fija + débito automático     Pagado                                  = fecha      el de la plantilla
 *   Fija + a mano                unpaidStatusFor(fecha, hoy)             null         el de la plantilla
 *
 * El gasto copia concepto, proveedor, categoría, responsable y notas de la plantilla EN ESE MOMENTO: editar la
 * plantilla después no lo cambia.
 */
import { fromCents, toCents } from "@/lib/shared/money";
import { addDays, compareCivil, type CivilDate } from "./dates";
import { unpaidStatusFor, type ExpenseStatus } from "./expense-status";
import { getPendingPaymentDates } from "./recurrence";
import { templateForEngine, type RecurringTemplateRow } from "./recurring";

/** Cuánto hacia atrás mira el trabajo diario (se pone al día lo que faltó, no más). */
export const GENERATION_LOOKBACK_DAYS = 62;
/** Tope de seguridad por corrida y por workspace; lo que sobre queda para el día siguiente. */
export const MAX_GENERATED_PER_RUN = 500;

/** La parte de la plantilla que usa la generación (con `id`, que es el `recurring_expense_id` del gasto). */
export type RecurringTemplateForGeneration = Pick<
  RecurringTemplateRow,
  | "concept"
  | "vendor_id"
  | "category_key"
  | "amount_type"
  | "amount"
  | "charge_mode"
  | "frequency"
  | "weekly_day"
  | "weekly_interval"
  | "monthly_day"
  | "yearly_month"
  | "yearly_day"
  | "start_date"
  | "end_date"
  | "lead_days"
  | "generation_anchor"
  | "responsible_id"
  | "notes"
> & { id: string };

/** La fila de `expenses` lista para insertar (falta `workspace_id`, que pone quien llama). */
export interface RecurringExpenseRow {
  concept: string;
  vendor_id: string | null;
  category_key: string;
  amount: number;
  status: ExpenseStatus;
  scheduled_date: CivilDate;
  paid_date: CivilDate | null;
  origin: "recurring";
  recurring_expense_id: string;
  responsible_id: string | null;
  notes: string | null;
  created_by: null;
}

/**
 * Qué gasto nace de la plantilla para esa fecha de pago programada. Un débito automático cuya fecha todavía no
 * llegó NO se marca pagado (no se puede pagar a futuro): queda programado. El trabajo diario no lo pide así
 * (con débito automático la anticipación es 0), pero la regla no depende de eso.
 */
export function buildRecurringExpense(template: RecurringTemplateForGeneration, scheduledDate: CivilDate, todayLocal: CivilDate): RecurringExpenseRow {
  const base = {
    concept: template.concept,
    vendor_id: template.vendor_id,
    category_key: template.category_key,
    scheduled_date: scheduledDate,
    origin: "recurring" as const,
    recurring_expense_id: template.id,
    responsible_id: template.responsible_id,
    notes: template.notes,
    created_by: null,
  };

  // Variable: falta el monto, lo confirma una persona. El estimado de la plantilla no se copia.
  if (template.amount_type === "variable") {
    return { ...base, amount: 0, status: "por_revisar", paid_date: null };
  }

  const amount = fromCents(toCents(template.amount));
  if (template.charge_mode === "automatic" && scheduledDate <= todayLocal) {
    return { ...base, amount, status: "pagado", paid_date: scheduledDate };
  }
  return { ...base, amount, status: unpaidStatusFor(scheduledDate, todayLocal), paid_date: null };
}

/**
 * Las fechas de pago a generar hoy: `getPendingPaymentDates` desde el más tardío de `generation_anchor`,
 * `start_date` y hoy − 62 días, hasta hoy. Con débito automático no hay anticipación. Una fila con una regla
 * inválida no genera nada (el handler la anota como fallo).
 */
export function datesToGenerate(template: RecurringTemplateForGeneration, todayLocal: CivilDate): CivilDate[] {
  const engine = templateForEngine(template);
  if (!engine) return [];
  let from = addDays(todayLocal, -GENERATION_LOOKBACK_DAYS);
  for (const candidate of [template.generation_anchor, template.start_date]) if (compareCivil(candidate, from) > 0) from = candidate;
  const leadDays = template.charge_mode === "automatic" ? 0 : template.lead_days;
  return getPendingPaymentDates(engine, from, todayLocal, leadDays);
}
