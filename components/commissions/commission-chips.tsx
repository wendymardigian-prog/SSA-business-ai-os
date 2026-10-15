import type { StatusTone } from "@/lib/finance/expense-status";
import type { CommissionStatusResult } from "@/lib/commissions/status";

/**
 * Los chips de Comisiones: el estado (un color por estado en todas las pantallas, igual que los de Gastos) y el rol.
 * No tienen estado propio: se pintan con lo que decide `lib/commissions/status.ts`.
 */
const TONES: Record<StatusTone, string> = {
  amber: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  blue: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
  red: "bg-red-500/12 text-red-600 dark:text-red-300",
  green: "bg-green-500/12 text-green-600 dark:text-green-300",
  gray: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-300",
};

export const toneClasses = (tone: StatusTone): string => TONES[tone];

export function CommissionStatusChip({ status, className = "" }: { status: Pick<CommissionStatusResult, "label" | "tone">; className?: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[status.tone]} ${className}`}>{status.label}</span>;
}

export function RoleChip({ name }: { name: string | null }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return <span className="inline-flex max-w-full items-center truncate rounded-full border border-border px-2 py-0.5 text-xs">{name}</span>;
}
