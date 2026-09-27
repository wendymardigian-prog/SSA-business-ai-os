/**
 * Tiempo fuera (F13): la parte pura. Convierte lo que carga la persona (fechas,
 * y horas si no son días completos) a los instantes UTC que se guardan en
 * `out_of_office`. La consulta de agendas en conflicto la hace la Tanda B.
 */
import type { DateString, OutOfOfficeReason, WallTime } from "./types";
import { addDays, isValidDateString, isValidWallTime, wallClockToUtc } from "./time/tz";

export const OUT_OF_OFFICE_REASONS: OutOfOfficeReason[] = ["vacation", "travel", "sick", "other"];

export const OUT_OF_OFFICE_REASON_LABELS: Record<OutOfOfficeReason, string> = {
  vacation: "Vacaciones",
  travel: "Viaje",
  sick: "Enfermedad",
  other: "Otro",
};

export interface OutOfOfficeInput {
  from: DateString;
  to: DateString;
  /** Días completos en la zona (por defecto encendido). */
  allDay: boolean;
  /** Solo si `allDay` es false. */
  fromTime?: WallTime;
  toTime?: WallTime;
}

export type OutOfOfficeUtc =
  | { ok: true; startsAt: string; endsAt: string }
  | { ok: false; error: string };

/**
 * Días completos: desde las 00:00 del primer día hasta las 00:00 del día
 * siguiente al último (fin exclusivo). 20/12 a 31/12 en Costa Rica →
 * 20/12 06:00Z a 01/01 06:00Z.
 */
export function outOfOfficeToUtc(input: OutOfOfficeInput, tz: string): OutOfOfficeUtc {
  if (!isValidDateString(input.from) || !isValidDateString(input.to)) {
    return { ok: false, error: "Las fechas tienen que ser YYYY-MM-DD válidas" };
  }
  if (input.to < input.from) {
    return { ok: false, error: "El fin tiene que ser posterior al inicio" };
  }

  if (input.allDay) {
    return {
      ok: true,
      startsAt: wallClockToUtc(input.from, "00:00", tz).toISOString(),
      endsAt: wallClockToUtc(addDays(input.to, 1), "00:00", tz).toISOString(),
    };
  }

  if (!isValidWallTime(input.fromTime ?? "") || !isValidWallTime(input.toTime ?? "")) {
    return { ok: false, error: "Indicá la hora de inicio y de fin (HH:mm)" };
  }
  const startsAt = wallClockToUtc(input.from, input.fromTime as WallTime, tz);
  const endsAt = wallClockToUtc(input.to, input.toTime as WallTime, tz);
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, error: "El fin tiene que ser posterior al inicio" };
  }
  return { ok: true, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

/** Verdadero si dos intervalos UTC (ISO) se superponen. Se usa para el aviso de agendas en el período. */
export function overlapsUtc(
  a: { startUtc: string; endUtc: string },
  b: { startUtc: string; endUtc: string },
): boolean {
  return new Date(a.startUtc).getTime() < new Date(b.endUtc).getTime() &&
    new Date(b.startUtc).getTime() < new Date(a.endUtc).getTime();
}
