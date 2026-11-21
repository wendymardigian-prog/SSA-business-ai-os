"use client";

/**
 * «Ver todo» de un día: todo lo de ese día ordenado por hora (reuniones, tareas y eventos de Google), con los
 * interruptores «Mostrar tareas» y «Mostrar eventos de Google». Tocar un ítem cierra el modal y abre su panel. Las
 * reglas (orden, filtro) viven en `lib/calendar/day-agenda.ts`.
 */
import { useEffect, useState } from "react";
import { CalendarDays, CheckSquare, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { filterDayEntries, type DayEntry } from "@/lib/calendar/day-agenda";
import { cn } from "@/lib/utils";

function EntryIcon({ kind }: { kind: DayEntry["kind"] }) {
  if (kind === "booking") return <CalendarDays className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden />;
  if (kind === "task") return <CheckSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/google-calendar.svg" alt="" aria-hidden className="h-4 w-4 shrink-0 opacity-60" />;
}

export function DayAgendaModal({
  title,
  entries,
  tasksAvailable,
  googleAvailable,
  onPick,
  onClose,
}: {
  /** «Jueves, 19 de noviembre». */
  title: string;
  entries: DayEntry[];
  /** La capa de tareas está prendida (si no, el modal no tiene sus datos). */
  tasksAvailable: boolean;
  googleAvailable: boolean;
  onPick: (entry: DayEntry) => void;
  onClose: () => void;
}) {
  const [showTasks, setShowTasks] = useState(tasksAvailable);
  const [showGoogle, setShowGoogle] = useState(googleAvailable);
  const list = filterDayEntries(entries, { tasks: showTasks && tasksAvailable, google: showGoogle && googleAvailable });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Todo el ${title}`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card"
      >
        <header className="flex items-start gap-2 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{title}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <span className="flex items-center gap-2" title={tasksAvailable ? undefined : "Prendé las tareas en «Qué mostrar»"}>
                <Switch checked={showTasks && tasksAvailable} disabled={!tasksAvailable} size="sm" label="Mostrar tareas" onChange={setShowTasks} />
                <span className={cn(!tasksAvailable && "text-muted-foreground")}>Mostrar tareas</span>
              </span>
              <span className="flex items-center gap-2" title={googleAvailable ? undefined : "Prendé los eventos de Google en «Qué mostrar»"}>
                <Switch checked={showGoogle && googleAvailable} disabled={!googleAvailable} size="sm" label="Mostrar eventos de Google" onChange={setShowGoogle} />
                <span className={cn(!googleAvailable && "text-muted-foreground")}>Mostrar eventos de Google</span>
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </header>
        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          {list.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nada para mostrar ese día.</li>}
          {list.map((entry) => {
            const content = (
              <>
                <EntryIcon kind={entry.kind} />
                <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">{entry.timeLabel}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block break-words text-sm", entry.kind === "booking" ? "font-medium" : "text-muted-foreground")}>{entry.title}</span>
                  {entry.sub && <span className="block break-words text-xs text-muted-foreground">{entry.sub}</span>}
                </span>
              </>
            );
            return (
              <li key={`${entry.kind}:${entry.id}`}>
                {entry.openable ? (
                  <button type="button" onClick={() => onPick(entry)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted">
                    {content}
                  </button>
                ) : (
                  <div className="flex items-start gap-3 px-4 py-2.5">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
