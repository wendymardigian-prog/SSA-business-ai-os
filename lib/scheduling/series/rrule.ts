// @plantilla-quitar(servicios)
/**
 * La regla de repetición de Google Calendar (RFC 5545) de una serie de reuniones que fija el responsable (00524,
 * traído de RER #71). PURO.
 *
 * Sale de la repetición del paso (`recurrence`, ver lib/services/engine-rules.ts) y del primer día elegido:
 *  - Cada día → FREQ=DAILY. Cada N días → FREQ=DAILY;INTERVAL=N.
 *  - Cada semana / cada N semanas, en uno o varios días → FREQ=WEEKLY;INTERVAL=N;BYDAY=MO,TH (sin días: el del primero).
 *  - Cada mes el día D → FREQ=MONTHLY;BYMONTHDAY=D. Del 29 al 31, BYMONTHDAY=28..D;BYSETPOS=-1: el día D o, si el mes
 *    no lo tiene, el último (BYMONTHDAY=31 a secas saltea los meses sin 31).
 *
 * Nunca lleva COUNT: «N vueltas» cuenta solo las cumplidas, así que la plataforma corta la serie cuando se cumple.
 */
import { isoWeekday, type Recurrence } from "@/lib/services/engine-rules";

const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

function cleanDays(r: Pick<Recurrence, "weekdays">): number[] {
  return Array.isArray(r.weekdays) ? [...new Set(r.weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b) : [];
}

export function rruleFor(r: Recurrence, firstDate: string): string {
  const parts: string[] = [];
  switch (r.every) {
    case "day":
      parts.push("FREQ=DAILY");
      break;
    case "n_days":
      parts.push("FREQ=DAILY", `INTERVAL=${Math.max(1, r.n ?? 1)}`);
      break;
    case "week":
    case "n_weeks": {
      const chosen = cleanDays(r);
      const days = chosen.length > 0 ? chosen : [isoWeekday(firstDate)];
      parts.push("FREQ=WEEKLY");
      if (r.every === "n_weeks" && (r.n ?? 1) > 1) parts.push(`INTERVAL=${r.n}`);
      parts.push(`BYDAY=${days.map((d) => DAY_CODES[d - 1]).join(",")}`);
      break;
    }
    case "month": {
      const d = Number.isInteger(r.day_of_month) && r.day_of_month! >= 1 && r.day_of_month! <= 31 ? r.day_of_month! : Number(firstDate.slice(8, 10));
      parts.push("FREQ=MONTHLY");
      if (d <= 28) parts.push(`BYMONTHDAY=${d}`);
      else parts.push(`BYMONTHDAY=${Array.from({ length: d - 27 }, (_, i) => 28 + i).join(",")}`, "BYSETPOS=-1");
      break;
    }
  }
  return `RRULE:${parts.join(";")}`;
}

/** El primer día elegido tiene que ser una fecha de la serie (si no, Google la sumaría como una reunión suelta). */
export function firstDateProblem(r: Recurrence, firstDate: string): string | null {
  if (r.every === "week" || r.every === "n_weeks") {
    const days = cleanDays(r);
    if (days.length > 0 && !days.includes(isoWeekday(firstDate))) return "El primer día tiene que ser uno de los días de la semana del paso.";
  }
  if (r.every === "month" && Number.isInteger(r.day_of_month)) {
    const [y, m, d] = firstDate.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d !== Math.min(r.day_of_month!, last)) return `El primer día tiene que ser el ${r.day_of_month} del mes (o el último, si el mes no lo tiene).`;
  }
  return null;
}
