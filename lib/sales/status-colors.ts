/**
 * Un color por estado en todas las pantallas (plano §13.0). Mismas clases que
 * `components/scheduling/bookings/status-chip.tsx`: `dark:` sigue a la clase
 * `.dark` del <html> (ver app/globals.css).
 */
import type { PaymentStatus, SaleStatus } from "./labels";

const TONES = {
  blue: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
  green: "bg-green-500/12 text-green-600 dark:text-green-300",
  emerald: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  amber: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  orange: "bg-orange-500/12 text-orange-600 dark:text-orange-300",
  red: "bg-red-500/12 text-red-600 dark:text-red-300",
  rose: "bg-rose-500/12 text-rose-600 dark:text-rose-300",
  violet: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  slate: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
  zinc: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-300",
} as const;

export type Tone = keyof typeof TONES;

export const SALE_STATUS_TONE: Record<SaleStatus, Tone> = {
  pending_payment: "amber",
  reserved: "blue",
  paid: "green",
  overdue: "red",
  subscription_active: "violet",
  cancelled: "zinc",
  refunded: "slate",
  disputed: "orange",
  subscription_cancelled: "rose",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  scheduled: "blue",
  paid: "green",
  overdue: "red",
  uncollectible: "orange",
  refunded: "slate",
  cancelled: "zinc",
};

export function toneClasses(tone: Tone): string {
  return TONES[tone];
}

export function saleStatusClasses(status: string): string {
  return TONES[(SALE_STATUS_TONE as Record<string, Tone>)[status] ?? "zinc"];
}

export function paymentStatusClasses(status: string): string {
  return TONES[(PAYMENT_STATUS_TONE as Record<string, Tone>)[status] ?? "zinc"];
}
