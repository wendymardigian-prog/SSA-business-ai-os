"use client";

import { useState } from "react";
import { normalizeProjectKey } from "@/lib/tasks/project";
import { TASK_SOURCES } from "@/lib/tasks/types";

const SOURCE_LABELS: Record<(typeof TASK_SOURCES)[number], string> = { manual: "Manual", flow: "Flujo", agent: "Agente", cx: "CX" };

/**
 * Los filtros de los disparadores de Tareas (F25): proyectos y origenes. Sin elegir nada vale para cualquier tarea. Si la
 * tarea no tiene contacto, el flujo corre sin contacto (los pasos que necesitan uno se saltean).
 */
export function TaskTriggerPanel({ triggerType, data, onChange }: { triggerType: string; data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const projects = ((data.projects as string[] | undefined) ?? []).filter(Boolean);
  const sources = ((data.sources as string[] | undefined) ?? []).filter(Boolean);
  // Se escribe como texto libre y se guarda ya normalizado (minusculas, sin acentos), que es como se comparan.
  const [text, setText] = useState(projects.join(", "));

  const set = (key: string, value: string[]) => {
    const next = { ...data };
    if (value.length === 0) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-xs font-semibold text-foreground">Filtros (opcionales)</p>
      <div>
        <label htmlFor="tt-projects" className="mb-1.5 block text-xs font-medium text-foreground">Solo de estos proyectos</label>
        <input
          id="tt-projects"
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            set("projects", e.target.value.split(",").map((p) => normalizeProjectKey(p)).filter((p): p is string => !!p));
          }}
          placeholder="Lanzamiento Q4, Operaciones"
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">Separados por coma. Mayúsculas y acentos no cuentan.</p>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-foreground">Solo de este origen</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {TASK_SOURCES.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input type="checkbox" checked={sources.includes(s)} onChange={() => set("sources", sources.includes(s) ? sources.filter((x) => x !== s) : [...sources, s])} />
              {SOURCE_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-[11px] text-muted-foreground/70">
        Sin elegir nada, vale para cualquier tarea.
        {triggerType === "task_overdue" ? " Se dispara una sola vez por vencimiento, y solo si la tarea tiene responsable o seguidores." : " Se dispara cada vez que se completa, también si se reabrió y se volvió a completar."}
        {" "}Las variables {"{{task.title}}"}, {"{{task.project}}"}, {"{{task.due_date}}"}, {"{{task.owner}}"} y {"{{task.url}}"} quedan disponibles. Si la tarea no tiene contacto, el flujo corre sin contacto: los pasos que necesitan uno se saltean.
      </p>
    </div>
  );
}
