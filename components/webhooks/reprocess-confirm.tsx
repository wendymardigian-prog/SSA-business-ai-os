"use client";

import { useId, useState } from "react";
import { RERUN_LABEL, RERUN_WARNING, reprocessIntro } from "@/lib/webhooks/reprocess-copy";

/**
 * La confirmación de «Reprocesar» (Tirón 2, C2). Reemplaza al `window.confirm`, que no puede mostrar una casilla.
 * Por defecto NO repite los flujos que ya corrieron; la casilla «Volver a correr también…» los repite todos y
 * está apagada, con su advertencia siempre visible. Los textos salen de `lib/webhooks/reprocess-copy.ts`.
 */
export function ReprocessConfirm({ count, alreadyProcessed, pending, onConfirm, onCancel }: {
  count: number;
  alreadyProcessed?: boolean;
  pending: boolean;
  onConfirm: (rerunCompleted: boolean) => void;
  onCancel: () => void;
}) {
  const [rerun, setRerun] = useState(false);
  const checkId = useId();
  const warningId = useId();

  return (
    <div role="group" aria-label="Confirmar el reproceso" className="space-y-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <p>{reprocessIntro({ count, alreadyProcessed })}</p>
      <div className="flex items-start gap-2">
        <input id={checkId} type="checkbox" checked={rerun} onChange={(e) => setRerun(e.target.checked)} aria-describedby={warningId} className="mt-0.5 size-4 shrink-0" />
        <div>
          <label htmlFor={checkId} className="font-medium">{RERUN_LABEL}</label>
          <p id={warningId} className={`text-xs ${rerun ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{RERUN_WARNING}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => onConfirm(rerun)} className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {rerun ? "Reprocesar y volver a correr todo" : "Reprocesar"}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">Cancelar</button>
      </div>
    </div>
  );
}
