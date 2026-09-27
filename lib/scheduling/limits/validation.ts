/**
 * Validación de la sección "Límites y buffers" del evento (F21).
 *
 * Rechaza lo que no se puede guardar (fechas al revés, valores fuera de las
 * opciones) y advierte lo que se puede guardar pero no va a producir horarios
 * (aviso mínimo mayor que la ventana futura).
 */
import { z } from "zod";
import type { PeriodType } from "../types";
import { isValidDateString, dateInTz, addDays } from "../time/tz";
import { BUFFER_OPTIONS, SLOT_INTERVAL_OPTIONS } from "./buffers";
import { addBusinessDays } from "./period";

export const PERIOD_TYPES: PeriodType[] = ["rolling_calendar", "rolling_business", "range", "unlimited"];

const dateOrNull = z.string().refine(isValidDateString, "Fecha inválida").nullable().optional();
const positiveIntOrNull = z.number().int().min(1).nullable().optional();

export const limitsSchema = z
  .object({
    before_buffer_minutes: z.number().refine((v) => (BUFFER_OPTIONS as readonly number[]).includes(v), {
      message: "Buffer inválido",
    }),
    after_buffer_minutes: z.number().refine((v) => (BUFFER_OPTIONS as readonly number[]).includes(v), {
      message: "Buffer inválido",
    }),
    minimum_notice_minutes: z.number().int().min(0).max(365 * 1440),
    slot_interval_minutes: z
      .number()
      .refine((v) => (SLOT_INTERVAL_OPTIONS as readonly number[]).includes(v), { message: "Intervalo inválido" })
      .nullable()
      .optional(),
    max_per_day: positiveIntOrNull,
    max_per_week: positiveIntOrNull,
    period_type: z.enum(PERIOD_TYPES as [PeriodType, ...PeriodType[]]),
    period_days: z.number().int().min(1).max(730).nullable().optional(),
    period_start_date: dateOrNull,
    period_end_date: dateOrNull,
  })
  .superRefine((v, ctx) => {
    if ((v.period_type === "rolling_calendar" || v.period_type === "rolling_business") && !v.period_days) {
      ctx.addIssue({ code: "custom", path: ["period_days"], message: "Indicá la cantidad de días" });
    }
    if (v.period_type === "range") {
      if (!v.period_start_date || !v.period_end_date) {
        ctx.addIssue({ code: "custom", path: ["period_end_date"], message: "Indicá las dos fechas" });
      } else if (v.period_end_date < v.period_start_date) {
        ctx.addIssue({
          code: "custom",
          path: ["period_end_date"],
          message: "El fin tiene que ser posterior al inicio",
        });
      }
    }
  });

export type LimitsInput = z.input<typeof limitsSchema>;

export type LimitsWarning = "no_slots_possible";

export type LimitsValidation =
  | { ok: true; warnings: LimitsWarning[] }
  | { ok: false; errors: { path: string; message: string }[] };

/**
 * Valida y, si pasa, calcula advertencias. La ventana se mide desde `now`
 * en la zona `tz` (la del horario), igual que en el motor.
 */
export function validateLimits(input: unknown, now: Date = new Date(), tz: string = "UTC"): LimitsValidation {
  const parsed = limitsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const v = parsed.data;
  const warnings: LimitsWarning[] = [];

  // ¿El aviso mínimo alcanza o supera el fin de la ventana? Entonces no habrá horarios.
  const today = dateInTz(now, tz);
  let lastDay: string | null = null;
  if (v.period_type === "rolling_calendar") lastDay = addDays(today, v.period_days ?? 0);
  if (v.period_type === "rolling_business") lastDay = addBusinessDays(today, v.period_days ?? 0);
  if (v.period_type === "range") lastDay = v.period_end_date ?? null;

  if (lastDay) {
    const earliestDay = dateInTz(new Date(now.getTime() + v.minimum_notice_minutes * 60_000), tz);
    if (earliestDay > lastDay) warnings.push("no_slots_possible");
  }

  return { ok: true, warnings };
}

export const LIMITS_WARNING_TEXT: Record<LimitsWarning, string> = {
  no_slots_possible: "No va a haber horarios disponibles",
};
