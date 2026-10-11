/**
 * El desfase de un cobro (plano F31): cuántos días de calendario pasaron entre el vencimiento
 * ORIGINAL y el día en que se cobró, medidos en la zona del workspace (la misma lógica que
 * escribe `payments.paid_on`, de donde sale `delay_days`). Puro.
 */
import { daysBetween, localDate } from "./dates";

/** Un cobro a las 23:50 locales del día del vencimiento es 0; a las 00:30 del siguiente, 1. */
export function paymentDelayDays(originalDueDate: string | null | undefined, paidAt: Date | string | number, timeZone: string): number | null {
  if (!originalDueDate) return null;
  return daysBetween(originalDueDate, localDate(paidAt, timeZone));
}

/** Umbrales del chip: hasta 7 días tarde es ámbar; de 8 en adelante, rojo. */
export const DELAY_THRESHOLDS = { amberUpTo: 7 } as const;

export type DelayTone = "green" | "blue" | "amber" | "red" | "none";

export interface DelayChip {
  label: string;
  tone: DelayTone;
}

export function delayChip(delayDays: number | null | undefined): DelayChip {
  if (delayDays == null) return { label: "—", tone: "none" };
  if (delayDays === 0) return { label: "puntual", tone: "green" };
  if (delayDays < 0) return { label: `−${Math.abs(delayDays)} d`, tone: "blue" };
  return { label: `+${delayDays} d`, tone: delayDays <= DELAY_THRESHOLDS.amberUpTo ? "amber" : "red" };
}

export const DELAY_TONE_CLASSES: Record<DelayTone, string> = {
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  none: "text-muted-foreground",
};
