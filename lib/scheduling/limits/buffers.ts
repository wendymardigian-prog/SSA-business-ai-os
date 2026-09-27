/**
 * Buffers y opciones de la sección "Límites y buffers" (F21).
 */
import type { UtcInterval } from "../types";

/** Minutos de buffer antes o después que ofrece la pantalla. */
export const BUFFER_OPTIONS = [0, 5, 10, 15, 30, 60] as const;

/** Intervalo entre horarios. null en el evento = igual a la duración. */
export const SLOT_INTERVAL_OPTIONS = [5, 10, 15, 20, 30, 60] as const;

export type NoticeUnit = "minutes" | "hours" | "days";

export const DEFAULT_MINIMUM_NOTICE_MINUTES = 120;
export const DEFAULT_PERIOD_DAYS = 60;

/** "2 horas" → 120. Lo que se guarda en `minimum_notice_minutes`. */
export function noticeToMinutes(value: number, unit: NoticeUnit): number {
  const factor = unit === "days" ? 1440 : unit === "hours" ? 60 : 1;
  return Math.max(0, Math.round(value * factor));
}

/** 120 → { value: 2, unit: "hours" }: la unidad más grande que divide exacto. */
export function minutesToNotice(minutes: number): { value: number; unit: NoticeUnit } {
  if (minutes > 0 && minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes > 0 && minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

/** El intervalo entre horarios efectivo: el configurado o la duración. */
export function effectiveSlotInterval(durationMinutes: number, slotInterval?: number | null): number {
  return slotInterval && slotInterval > 0 ? slotInterval : durationMinutes;
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/**
 * Un intervalo ocupado, agrandado con los buffers de su evento: nadie puede
 * agendar `before` minutos antes ni `after` minutos después.
 */
export function expandWithBuffers(interval: UtcInterval, beforeMinutes: number, afterMinutes: number): UtcInterval {
  return {
    startUtc: addMinutes(interval.startUtc, -Math.max(0, beforeMinutes)),
    endUtc: addMinutes(interval.endUtc, Math.max(0, afterMinutes)),
  };
}
