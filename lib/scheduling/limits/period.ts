// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Ventana futura y aviso mínimo (F21, F23 paso 7). Adaptado de
 * `packages/lib/isOutOfBounds.tsx`: se quitan Prisma, los logs y el modo
 * "rolling window" (contar solo días con disponibilidad), que el plano no pide.
 *
 * Los cuatro tipos de ventana del plano:
 * - `rolling_calendar`: N días corridos desde hoy. El día N se incluye completo.
 * - `rolling_business`: N días hábiles (lunes a viernes) desde hoy, incluido completo.
 * - `range`: entre dos fechas, ambas incluidas completas.
 * - `unlimited`: sin tope.
 *
 * Las fechas se cortan en la zona `tz` (la del horario del anfitrión).
 */
import type { DateString, PeriodType } from "../types";
import { addDays, dateInTz, startOfDayUtc, weekdayInTz } from "../time/tz";

export interface PeriodConfig {
  periodType: PeriodType;
  periodDays?: number | null;
  periodStartDate?: DateString | null;
  periodEndDate?: DateString | null;
}

export interface PeriodBounds {
  /** Primer instante permitido (inclusive) o null si no hay tope por abajo. */
  fromUtc: Date | null;
  /** Primer instante NO permitido (exclusivo) o null si no hay tope por arriba. */
  toUtc: Date | null;
}

function isBusinessDay(date: DateString): boolean {
  const d = weekdayInTz(`${date}T12:00:00Z`, "UTC");
  return d >= 1 && d <= 5;
}

/** La fecha del N-ésimo día hábil después de `from` (N = 0 devuelve `from`). */
export function addBusinessDays(from: DateString, days: number): DateString {
  let date = from;
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    date = addDays(date, 1);
    if (isBusinessDay(date)) remaining--;
  }
  return date;
}

export function periodBounds(config: PeriodConfig, now: Date, tz: string): PeriodBounds {
  const today = dateInTz(now, tz);
  const days = Math.max(0, config.periodDays ?? 0);

  switch (config.periodType) {
    case "rolling_calendar": {
      const lastDay = addDays(today, days);
      return { fromUtc: null, toUtc: startOfDayUtc(addDays(lastDay, 1), tz) };
    }
    case "rolling_business": {
      const lastDay = addBusinessDays(today, days);
      return { fromUtc: null, toUtc: startOfDayUtc(addDays(lastDay, 1), tz) };
    }
    case "range": {
      const from = config.periodStartDate ? startOfDayUtc(config.periodStartDate, tz) : null;
      const to = config.periodEndDate ? startOfDayUtc(addDays(config.periodEndDate, 1), tz) : null;
      return { fromUtc: from, toUtc: to };
    }
    case "unlimited":
    default:
      return { fromUtc: null, toUtc: null };
  }
}

export type OutOfBoundsReason = "past" | "minimum_notice" | "before_range" | "after_window";

export interface OutOfBoundsResult {
  out: boolean;
  reason: OutOfBoundsReason | null;
}

/**
 * Verdadero si un horario no se puede ofrecer: ya pasó, está dentro del aviso
 * mínimo, o cae fuera de la ventana futura.
 */
export function isOutOfBounds(
  slotStartUtc: Date | string,
  config: PeriodConfig & { minimumNoticeMinutes?: number | null },
  now: Date,
  tz: string,
): OutOfBoundsResult {
  const start = new Date(slotStartUtc).getTime();
  if (start < now.getTime()) return { out: true, reason: "past" };

  const notice = Math.max(0, config.minimumNoticeMinutes ?? 0);
  if (start < now.getTime() + notice * 60_000) return { out: true, reason: "minimum_notice" };

  const bounds = periodBounds(config, now, tz);
  if (bounds.fromUtc && start < bounds.fromUtc.getTime()) return { out: true, reason: "before_range" };
  if (bounds.toUtc && start >= bounds.toUtc.getTime()) return { out: true, reason: "after_window" };

  return { out: false, reason: null };
}
