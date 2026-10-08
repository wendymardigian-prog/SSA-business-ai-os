"use client";

/**
 * La pastilla de estado (F32). El color del catálogo es un nombre ("blue"),
 * no una clase: acá se traduce a clases fijas porque Tailwind necesita verlas
 * escritas para generarlas (una clase armada con plantillas no existe en el
 * CSS final).
 */

import type { BookingStatus } from "@/lib/scheduling/types";
import { statusDef } from "@/lib/scheduling/booking-status";

const CHIP: Record<string, string> = {
  blue: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
  green: "bg-green-500/12 text-green-600 dark:text-green-300",
  sky: "bg-sky-500/12 text-sky-600 dark:text-sky-300",
  orange: "bg-orange-500/12 text-orange-600 dark:text-orange-300",
  amber: "bg-amber-500/12 text-amber-600 dark:text-amber-300",
  slate: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
  emerald: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  zinc: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-300",
  rose: "bg-rose-500/12 text-rose-600 dark:text-rose-300",
};

const DOT: Record<string, string> = {
  blue: "bg-blue-500",
  green: "bg-green-500",
  sky: "bg-sky-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  slate: "bg-slate-500",
  emerald: "bg-emerald-500",
  zinc: "bg-zinc-500",
  rose: "bg-rose-500",
};

export function statusChipClass(status: BookingStatus): string {
  return CHIP[statusDef(status).color] ?? CHIP.zinc;
}

export function statusDotClass(status: BookingStatus): string {
  return DOT[statusDef(status).color] ?? DOT.zinc;
}

export function StatusChip({ status }: { status: BookingStatus }) {
  const def = statusDef(status);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusChipClass(status)}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${statusDotClass(status)}`} />
      {def.label}
    </span>
  );
}

/** "Sin resultado": la llamada pasó y nadie dijo cómo salió (F33). */
export function NeedsOutcomeChip() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-300">
      Sin resultado
    </span>
  );
}

/** Su horario dejó de contar como ocupado: el lugar está libre para otro lead (Agenda v2). */
export function SlotReleasedChip() {
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-violet-400 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-300">
      Espacio liberado
    </span>
  );
}
