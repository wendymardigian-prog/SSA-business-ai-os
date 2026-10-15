"use client";

import type { DragEvent, KeyboardEvent } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Archive, Copy, GripVertical, Pause, Pencil, Play } from "lucide-react";
import { RULE_STATES } from "@/lib/commissions/describe";
import { NO_PERSON_WARNING, SHADOWED_WARNING } from "@/lib/commissions/rules-ui-warnings";
import type { RuleView } from "@/lib/commissions/rules-view";
import { cn } from "@/lib/utils";
import { STATE_CLASSES, btnIcon, btnSmall } from "./ui";

/**
 * Una regla en la lista: su lugar, su nombre, la frase en palabras, su estado y los avisos. Para quien administra
 * se puede arrastrar (con el mouse) o mover con Alt + ↑/↓ estando enfocada; en pantallas táctiles, con los botones
 * de subir y bajar. Sin `commissions.manage` es solo texto.
 */
export interface RuleRowProps {
  view: RuleView;
  index: number;
  total: number;
  shadowed: boolean;
  missingPerson: boolean;
  canManage: boolean;
  busy: boolean;
  dragging: boolean;
  /** Dónde se marca que cae lo que se arrastra. */
  dropMark: "before" | "after" | null;
  registerRow: (element: HTMLLIElement | null) => void;
  hintId: string;
  onEdit: () => void;
  onDuplicate: () => void;
  onToggle: () => void;
  onArchive: () => void;
  onMove: (delta: -1 | 1) => void;
  onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLLIElement>) => void;
  onDrop: (event: DragEvent<HTMLLIElement>) => void;
}

export function RuleRow({
  view, index, total, shadowed, missingPerson, canManage, busy, dragging, dropMark, registerRow, hintId,
  onEdit, onDuplicate, onToggle, onArchive, onMove, onKeyDown, onDragStart, onDragEnd, onDragOver, onDrop,
}: RuleRowProps) {
  const state = RULE_STATES[view.state];
  const quiet = view.state !== "activa";
  const paused = !view.rule.is_active;

  return (
    <li
      ref={registerRow}
      tabIndex={canManage ? 0 : undefined}
      aria-describedby={canManage ? hintId : undefined}
      aria-keyshortcuts={canManage ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
      aria-posinset={index + 1}
      aria-setsize={total}
      data-rule-id={view.id}
      onKeyDown={canManage ? onKeyDown : undefined}
      onDragOver={canManage ? onDragOver : undefined}
      onDrop={canManage ? onDrop : undefined}
      className={cn(
        "relative rounded-xl border border-border bg-background p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragging && "opacity-40",
      )}
    >
      {dropMark && <span aria-hidden className={cn("pointer-events-none absolute inset-x-2 h-0.5 rounded bg-primary", dropMark === "before" ? "-top-[5px]" : "-bottom-[5px]")} />}

      <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {canManage && (
            <span
              draggable
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              aria-hidden
              title="Arrastrá para cambiar el orden"
              className="mt-0.5 hidden h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent active:cursor-grabbing [@media(pointer:fine)]:flex"
            >
              <GripVertical className="h-4 w-4" />
            </span>
          )}
          <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums" title={`Lugar ${index + 1} de ${total}`}>
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={cn("min-w-0 break-words text-sm font-medium", quiet && "text-muted-foreground")}>{view.name || "Regla sin nombre"}</h3>
              <span className={cn("inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", STATE_CLASSES[view.state])}>{state.label}</span>
            </div>
            <p className={cn("mt-0.5 break-words text-sm", quiet ? "text-muted-foreground/80" : "text-muted-foreground")}>{view.description}</p>
            {missingPerson && (
              <p role="status" className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{NO_PERSON_WARNING}</span>
              </p>
            )}
            {shadowed && (
              <p role="status" className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{SHADOWED_WARNING}</span>
              </p>
            )}
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-1.5 md:shrink-0 md:justify-end">
            <span className="hidden items-center gap-1.5 [@media(pointer:coarse)]:inline-flex">
              <button type="button" onClick={() => onMove(-1)} disabled={busy || index === 0} className={btnIcon} aria-label={`Subir «${view.name}» un lugar`}>
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" onClick={() => onMove(1)} disabled={busy || index === total - 1} className={btnIcon} aria-label={`Bajar «${view.name}» un lugar`}>
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
            </span>
            <button type="button" onClick={onEdit} disabled={busy} className={btnSmall}>
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Editar<span className="sr-only"> {view.name}</span>
            </button>
            <button type="button" onClick={onDuplicate} disabled={busy} className={btnSmall} title="Duplicar">
              <Copy className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Duplicar</span><span className="sr-only sm:hidden">Duplicar</span><span className="sr-only"> {view.name}</span>
            </button>
            <button type="button" onClick={onToggle} disabled={busy} className={btnSmall} title={paused ? "Reactivar" : "Pausar"}>
              {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
              <span className="hidden sm:inline">{paused ? "Reactivar" : "Pausar"}</span>
              <span className="sr-only sm:hidden">{paused ? "Reactivar" : "Pausar"}</span>
              <span className="sr-only"> {view.name}</span>
            </button>
            <button type="button" onClick={onArchive} disabled={busy} className={btnSmall} title="Archivar">
              <Archive className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Archivar</span><span className="sr-only sm:hidden">Archivar</span><span className="sr-only"> {view.name}</span>
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
