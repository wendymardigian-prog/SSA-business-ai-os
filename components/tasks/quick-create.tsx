"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { TASK_LIMITS } from "@/lib/tasks/types";

/**
 * La fila «+ Nueva tarea» (F15): escribir el titulo y apretar Enter crea la tarea y deja el foco listo
 * para la siguiente. En un grupo por proyecto, la tarea nace en ese proyecto.
 */
export function QuickCreate({ project, onCreate }: { project: string | null; onCreate: (title: string, project: string | null) => Promise<boolean> }) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // El campo se vacia al instante para poder escribir la siguiente mientras se crea esta; si falla, el titulo vuelve
  // (salvo que ya se haya empezado a escribir otro): nunca se pierde lo escrito.
  async function submit() {
    const title = value.trim();
    if (!title) return;
    setValue("");
    const created = await onCreate(title, project);
    if (!created) setValue((current) => current || title);
    input.current?.focus();
  }

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <Plus className="h-4 w-4 shrink-0" aria-hidden />
      <span className="sr-only">Nueva tarea{project ? ` en ${project}` : ""}</span>
      <input
        ref={input}
        value={value}
        maxLength={TASK_LIMITS.title}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            setValue("");
          }
        }}
        placeholder={project ? `Nueva tarea en ${project}` : "Nueva tarea"}
        className="h-8 min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground focus:placeholder:text-muted-foreground/60"
      />
    </label>
  );
}
