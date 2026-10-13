"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { SourceContext } from "@/lib/tasks/format";
import type { RowGroup } from "@/lib/tasks/table-model";
import type { TaskStatus } from "@/lib/tasks/types";
import { QuickCreate } from "./quick-create";
import { TaskCard } from "./task-card";

/**
 * La lista de tarjetas de Tareas para el celular (F21): titulo, estado, vencimiento y responsable de cada tarea. El
 * estado y la fecha se cambian desde el menu de la tarjeta; tocar el titulo abre la tarea a pantalla completa.
 */
export function TasksList({
  groups, today, canEdit, busy, source, onOpen, onStatus, onDue, onQuickCreate, remaining, onLoadMore, totalShown,
}: {
  groups: RowGroup[];
  today: string;
  canEdit: boolean;
  busy: ReadonlySet<string>;
  source: SourceContext;
  onOpen: (taskId: string, origin: HTMLElement | null) => void;
  onStatus: (taskId: string, status: TaskStatus) => void;
  onDue: (taskId: string, due: string | null) => void;
  onQuickCreate: (title: string, project: string | null) => Promise<boolean>;
  remaining: number;
  onLoadMore: () => void;
  totalShown: number;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const grouped = groups.length > 1 || groups[0]?.key !== "all";
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const isCollapsed = grouped && collapsed.has(group.key);
        return (
          <section key={group.key} aria-label={group.label || "Tareas"}>
            {grouped && (
              <button type="button" onClick={() => toggle(group.key)} aria-expanded={!isCollapsed} className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold">
                {isCollapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                {group.label}
                <span className="rounded-full bg-muted px-1.5 text-[11px] font-normal text-muted-foreground">{group.rows.length}</span>
              </button>
            )}
            {!isCollapsed && (
              <ul className="space-y-2">
                {group.rows.map((view) => (
                  <li key={view.id}>
                    <TaskCard
                      view={view}
                      today={today}
                      canEdit={canEdit}
                      busy={busy.has(view.id)}
                      source={source}
                      variant="list"
                      onOpen={(origin) => onOpen(view.id, origin)}
                      onStatus={(s) => onStatus(view.id, s)}
                      onDue={(d) => onDue(view.id, d)}
                    />
                  </li>
                ))}
                {canEdit && (
                  <li className="rounded-xl border border-dashed border-border px-3 py-1">
                    <QuickCreate project={group.project} onCreate={onQuickCreate} />
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
      {remaining > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Mostrando {totalShown} de {totalShown + remaining}.</span>
          <button type="button" onClick={onLoadMore} className="h-8 rounded-lg border border-border px-3 hover:bg-accent">Cargar {Math.min(100, remaining)} más</button>
        </div>
      )}
    </div>
  );
}
