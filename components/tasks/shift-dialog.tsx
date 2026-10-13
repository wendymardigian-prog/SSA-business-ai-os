"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import type { CompletionPlan } from "@/lib/tasks/core";
import { formatDay, pluralDays } from "@/lib/tasks/format";
import { groupShiftsByChain, shiftSummary } from "@/lib/tasks/shift-preview";
import { CenterDialog } from "./overlay";

/**
 * La vista previa de fechas (F13): al completar una tarea que atrasa a otras, se muestra que fecha
 * pasa a cual y la persona decide. Cerrar con Esc, con el fondo o con la X NO completa nada.
 */
export function ShiftDialog({
  plan,
  onConfirm,
  onClose,
}: {
  plan: CompletionPlan;
  /** `true` = mover las fechas y completar; `false` = completar sin mover. */
  onConfirm: (applyShifts: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [working, setWorking] = useState<"move" | "keep" | null>(null);
  const chains = groupShiftsByChain(plan.shifts);

  async function run(apply: boolean) {
    setWorking(apply ? "move" : "keep");
    try {
      await onConfirm(apply);
    } finally {
      setWorking(null);
    }
  }

  return (
    <CenterDialog label="Mover fechas al completar" className="max-w-xl" onClose={() => (working ? undefined : onClose())}>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <h2 className="text-base font-semibold">Completar «{plan.title}»</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {shiftSummary(plan.shifts.length)}: lo que depende de esta tarea no puede vencer antes de que se complete. Hoy es {formatDay(plan.completedOn)}.
        </p>

        <div className="mt-4 space-y-4">
          {chains.map((chain, i) => (
            <section key={i} aria-label={`Cadena que depende de ${chain.startTitle}`}>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Depende de «{chain.startTitle}»</h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {chain.shifts.map((s) => (
                  <li key={s.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 break-words font-medium">{s.title}</span>
                    <span className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
                      {formatDay(s.fromDue)}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      <span className="font-medium text-foreground">{formatDay(s.toDue)}</span>
                    </span>
                    <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">+{pluralDays(s.days)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button type="button" onClick={onClose} disabled={!!working} className="h-9 rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
          Cancelar
        </button>
        <button type="button" onClick={() => void run(false)} disabled={!!working} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">
          {working === "keep" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Completar sin mover fechas
        </button>
        <button type="button" onClick={() => void run(true)} disabled={!!working} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {working === "move" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Mover fechas y completar
        </button>
      </div>
    </CenterDialog>
  );
}
