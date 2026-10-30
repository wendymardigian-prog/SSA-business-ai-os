import { AlertTriangle, CheckCircle2, Circle, CircleDashed, CircleDot, Flag, Lock } from "lucide-react";
import { Avatar } from "@/components/ui/filter-menu";
import { colorOf, initialsOf } from "@/lib/shared/people";
import { PRIORITY_LABELS, STATUS_LABELS, type TaskPriority, type TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

/** Un color por estado, igual en toda la pantalla. `dark:` sigue a la clase `.dark` del <html>. */
export const STATUS_TONE: Record<TaskStatus, string> = {
  pending: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
  in_progress: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
  completed: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
};

export const PRIORITY_TONE: Record<TaskPriority, string> = {
  low: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-300",
  normal: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
  high: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  urgent: "bg-red-500/12 text-red-600 dark:text-red-300",
};

export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const Icon = status === "completed" ? CheckCircle2 : status === "in_progress" ? CircleDot : Circle;
  return <Icon className={cn("h-4 w-4 shrink-0", className)} aria-hidden />;
}

export function StatusChip({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium", STATUS_TONE[status], className)}>
      <StatusIcon status={status} className="h-3.5 w-3.5" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityChip({ priority, className }: { priority: TaskPriority; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium", PRIORITY_TONE[priority], className)}>
      <Flag className="h-3 w-3" aria-hidden />
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

/** Una persona: avatar y nombre. Sin persona, «Sin responsable» en gris. */
export function PersonBadge({ id, name, empty = "Sin responsable", compact = false }: { id: string | null; name: string | null; empty?: string; compact?: boolean }) {
  if (!id) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <CircleDashed className="h-4 w-4" aria-hidden />
        {!compact && <span className="text-sm">{empty}</span>}
      </span>
    );
  }
  const label = name ?? "Alguien del equipo";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar initials={initialsOf(label)} color={colorOf(id)} userId={id} />
      {!compact && <span className="truncate text-sm">{label}</span>}
      {compact && <span className="sr-only">{label}</span>}
    </span>
  );
}

export function BlockedMark({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  const text = count === 1 ? "Bloqueada por 1 tarea sin completar" : `Bloqueada por ${count} tareas sin completar`;
  return (
    <span title={text} className={cn("inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300", className)}>
      <Lock className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">{text}</span>
      {count > 1 && <span aria-hidden>{count}</span>}
    </span>
  );
}

export function OverdueMark({ className }: { className?: string }) {
  return <AlertTriangle className={cn("h-3.5 w-3.5 text-red-600 dark:text-red-400", className)} aria-label="Vencida" />;
}
