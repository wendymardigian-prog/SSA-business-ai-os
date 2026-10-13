"use client";

import type { CompleteTaskNodeData } from "@/lib/flow-engine/nodes/complete-task";

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

      {availableVariables && availableVariables.length > 0 && (
        <div>
          <p className="text-[11px] text-muted-foreground/70">Tocá una variable para agregarla a la clave.</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {availableVariables.map((variable) => (
              <button key={variable} type="button" onClick={() => set({ sourceKey: `${data.sourceKey ?? ""}{{${variable}}}` })} className="rounded px-1.5 py-0.5 font-mono text-[11px] font-medium text-blue-500 hover:bg-blue-50">
                {`{{${variable}}}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
