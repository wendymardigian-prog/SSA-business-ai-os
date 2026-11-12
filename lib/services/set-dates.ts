// @plantilla-quitar(servicios)
/**
 * «Más… › Editar fechas y plazo» de la ficha del servicio (Servicios A2, F130.3). Puro.
 *
 * Gemela de `app_servicio.svc_dates_plan` (00362): los casos de `set-dates.cases.json` corren contra las dos (vitest
 * y `verify-services --bloque a2`). Si se cambia una regla, se cambia en las dos y se suma el caso.
 *
 * El plazo no se guarda: es la cuenta de dias entre el inicio y el fin (los dos incluidos), igual que «Día 12 de 84».
 */

export type DatesPlanError = "SV016" | "SV040" | "SV041" | "SV042" | "SV043";

export interface DatesPlanInput {
  status: string;
  oldStartsOn: string | null;
  oldEndsOn: string | null;
  startsOn: string | null;
  endsOn: string | null;
  reason: string | null;
}

export type DatesPlan =
  | { ok: true; startShiftDays: number | null; durationDays: number | null }
  | { ok: false; error: DatesPlanError };

export const DATES_PLAN_MESSAGES: Record<DatesPlanError, string> = {
  SV016: "Escribí el motivo",
  SV040: "La fecha de fin tiene que ser igual o posterior al inicio",
  SV041: "No cambiaste ninguna fecha",
  SV042: "Este servicio ya terminó: sus fechas no se cambian",
  SV043: "Elegí la fecha de inicio",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const valid = (d: string | null): d is string => !!d && DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function datesEditPlan(i: DatesPlanInput): DatesPlan {
  if (["completed", "cancelled", "renewed"].includes(i.status)) return { ok: false, error: "SV042" };
  if (!i.reason || !i.reason.trim()) return { ok: false, error: "SV016" };
  if (!valid(i.startsOn)) return { ok: false, error: "SV043" };
  const endsOn = valid(i.endsOn) ? i.endsOn : null;
  if (endsOn && endsOn < i.startsOn) return { ok: false, error: "SV040" };
  if (i.startsOn === i.oldStartsOn && endsOn === (i.oldEndsOn ?? null)) return { ok: false, error: "SV041" };
  return {
    ok: true,
    startShiftDays: valid(i.oldStartsOn) ? days(i.oldStartsOn, i.startsOn) : null,
    durationDays: endsOn ? days(i.startsOn, endsOn) + 1 : null,
  };
}

/** El fin que corresponde a un inicio y un plazo en dias (los dos incluidos): lo usa el formulario al tocar el plazo. */
export function endFromDuration(startsOn: string, durationDays: number): string | null {
  if (!valid(startsOn) || !Number.isInteger(durationDays) || durationDays < 1) return null;
  return new Date(Date.parse(`${startsOn}T00:00:00Z`) + (durationDays - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** El plazo en dias entre un inicio y un fin (los dos incluidos); null si falta alguno o el fin es anterior. */
export function durationFromDates(startsOn: string | null, endsOn: string | null): number | null {
  if (!valid(startsOn) || !valid(endsOn) || endsOn < startsOn) return null;
  return days(startsOn, endsOn) + 1;
}
