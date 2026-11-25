"use client";

import type { CompleteTaskNodeData } from "@/lib/flow-engine/nodes/complete-task";
import { VariableChips } from "./variable-chips";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";

/**
 * El panel del nodo «Completar tarea» (R4): una sola cosa, la clave de origen de la(s) tarea(s) que cierra. Es la misma
 * clave que se le pone al paso «Crear tarea» (por ejemplo `payment:{{payment.id}}`).
 */
export function CompleteTaskPanel({ data: raw, onChange, availableVariables }: { data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void; availableVariables?: string[] }) {
  const data = raw as CompleteTaskNodeData & Record<string, unknown>;
  const set = (patch: Partial<CompleteTaskNodeData>) => onChange({ ...data, ...patch });

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="cpt-key" className={labelClass}>Clave de origen</label>
        <input id="cpt-key" type="text" maxLength={200} value={data.sourceKey ?? ""} onChange={(e) => set({ sourceKey: e.target.value })} placeholder="payment:{{payment.id}}" className={inputClass} />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Cierra las tareas abiertas que tengan esta clave, sin mover fechas de otras tareas. Si no hay ninguna, no pasa nada y el flujo sigue.
          Si la clave queda vacía (o una variable no se puede resolver), no se cierra nada.
        </p>
      </div>

      <VariableChips variables={availableVariables} onInsert={(token) => set({ sourceKey: `${data.sourceKey ?? ""}${token}` })} hint="Tocá una variable para agregarla a la clave." />
    </div>
  );
}
