import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { TaskIcon } from "./task-icon";
import { MODE_LABELS, formatSpend, lastRunLabel, type TaskRunInfo } from "@/lib/background/screen";
import type { TaskMode } from "@/lib/background/settings";
import type { AiTaskDef } from "@/lib/ai-tasks/catalog";

/**
 * La card de una tarea de IA en Agentes IA: más baja que la de un agente
 * (una sola línea de datos, sin el badge de encendido/apagado — "Apagada" ya
 * sale en el modo), con otro ícono por tarea. Clic lleva a su configuración,
 * instrucciones (si las tiene) y corridas.
 */
export function TaskCard({ task, mode, lastRun }: { task: AiTaskDef; mode: TaskMode | null; lastRun: TaskRunInfo | null }) {
  return (
    <Link
      href={`/dashboard/agents/tareas/${task.id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 transition-colors hover:bg-accent/40"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <TaskIcon icon={task.icon} className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{task.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {mode ? MODE_LABELS[mode] : "Siempre inmediata"}
          {" · "}
          {mode === "off" ? "Apagada" : lastRun ? lastRunLabel(lastRun.at) : "Sin corridas propias todavía"}
          {" · "}
          Gasto del mes: {formatSpend(lastRun?.monthSpendUsd ?? null)}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
