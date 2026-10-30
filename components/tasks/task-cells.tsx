"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { Avatar } from "@/components/ui/filter-menu";
import { cellKeyAction, type CellPatch, type EditableColumn } from "@/lib/tasks/cell-edit";
import { dueLabel, formatSource, type SourceContext } from "@/lib/tasks/format";
import { colorOf, initialsOf, summarizeNames } from "@/lib/shared/people";
import type { ProjectSummary } from "@/lib/tasks/project";
import type { MemberLite, TaskRowView } from "@/lib/tasks/table-model";
import { TASK_LIMITS } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { BlockedMark, PersonBadge, PriorityChip, StatusChip } from "./chips";
import { MemberPicker, MembersMultiPicker, PriorityPicker, ProjectPicker, StatusPicker } from "./pickers";
import { useTimeFormat } from "./time-format-context";

/** Lo que las celdas necesitan saber del resto de la pantalla. */
export interface CellEnv {
  members: MemberLite[];
  memberNames: ReadonlyMap<string, string>;
  projects: ProjectSummary[];
  today: string;
  canEdit: boolean;
  source: SourceContext;
}

export interface CellProps {
  view: TaskRowView;
  column: EditableColumn | "blocked" | "source";
  env: CellEnv;
  /** Fila y columna dentro de la tabla, para tabular entre celdas. */
  position: { row: number; col: number };
  editing: boolean;
  busy: boolean;
  onStartEdit: () => void;
  /** Termina la edicion; `dir` = hacia donde sigue el foco (Tab). */
  onEndEdit: (dir?: 1 | -1) => void;
  onCommit: (patch: CellPatch) => void;
  onOpen: () => void;
}

const dueTone: Record<ReturnType<typeof dueLabel>["tone"], string> = {
  overdue: "font-medium text-red-600 dark:text-red-400",
  today: "font-medium text-amber-700 dark:text-amber-300",
  soon: "text-foreground",
  normal: "text-muted-foreground",
  none: "text-muted-foreground",
  done: "text-muted-foreground",
};

/** La celda: un <td> enfocable que muestra el valor y, al editar, su editor. */
export function TaskCell(props: CellProps) {
  const { view, column, env, position, editing, busy, onStartEdit, onEndEdit, onCommit, onOpen } = props;
  const timeFormat = useTimeFormat();
  const ref = useRef<HTMLTableCellElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editable = env.canEdit && column !== "blocked" && column !== "source";

  // Al terminar de editar, el foco vuelve a la celda (si no, se pierde y el teclado queda a medias).
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) ref.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  useEffect(() => () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
  }, []);

  const end = (dir?: 1 | -1) => onEndEdit(dir);
  const commit = (patch: CellPatch, dir?: 1 | -1) => {
    onCommit(patch);
    end(dir);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableCellElement>) => {
    if (event.target !== event.currentTarget) return;
    const action = cellKeyAction({ key: event.key, shiftKey: event.shiftKey, editing: false });
    if (action === "open") {
      event.preventDefault();
      if (editable) onStartEdit();
      else onOpen();
    }
  };

  const onClick = () => {
    if (editing) return;
    if (column === "title") {
      // Un clic abre la tarea; dos clics seguidos editan el titulo en el lugar.
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(onOpen, editable ? 220 : 0);
      return;
    }
    if (editable) onStartEdit();
    else onOpen();
  };

  const onDoubleClick = () => {
    if (column !== "title" || !editable) return;
    if (clickTimer.current) clearTimeout(clickTimer.current);
    onStartEdit();
  };

  let body: ReactNode;
  switch (column) {
    case "status":
      body = <StatusChip status={view.status} />;
      break;
    case "title":
      body = editing ? (
        <TitleEditor initial={view.title} onCommit={(title, dir) => commit({ title }, dir)} onCancel={(dir) => end(dir)} />
      ) : (
        <span className={cn("block truncate text-sm font-medium", view.status === "completed" && "text-muted-foreground line-through")}>{view.title}</span>
      );
      break;
    case "owner":
      body = <PersonBadge id={view.ownerId} name={view.ownerName} />;
      break;
    case "followers":
      body = <FollowersDisplay ids={view.task.follower_ids} names={env.memberNames} />;
      break;
    case "project":
      body = view.project ? <span className="block truncate rounded-md bg-muted px-1.5 py-0.5 text-xs">{view.project}</span> : <span className="text-sm text-muted-foreground">—</span>;
      break;
    case "due": {
      const label = dueLabel({ due_date: view.dueDate, due_time: view.dueTime, status: view.status }, env.today, timeFormat);
      body = editing ? (
        <DateEditor
          initial={view.dueDate}
          initialTime={view.dueTime}
          onCommit={(next, dir) => {
            // Solo lo que cambio: cambiar el dia no toca la hora, y quitar la fecha quita la hora (el nucleo tambien lo hace).
            const patch: CellPatch = {};
            if (next.date !== view.dueDate) patch.due_date = next.date;
            if (next.time !== view.dueTime) patch.due_time = next.time;
            commit(patch, dir);
          }}
          onCancel={(dir) => end(dir)}
        />
      ) : (
        <span className={cn("text-sm", dueTone[label.tone])}>{label.text}</span>
      );
      break;
    }
    case "priority":
      body = <PriorityChip priority={view.priority} />;
      break;
    case "blocked":
      body = view.blocked ? <BlockedMark count={view.blockedCount} /> : null;
      break;
    case "source": {
      const info = formatSource(view.task, env.source);
      body = info.href ? (
        <Link href={info.href} onClick={(e) => e.stopPropagation()} className="truncate text-xs text-primary hover:underline">{info.label}</Link>
      ) : (
        <span className="truncate text-xs text-muted-foreground">{info.label}</span>
      );
      break;
    }
  }

  return (
    <td
      ref={ref}
      tabIndex={0}
      data-cell={`${position.row}:${position.col}`}
      data-column={column}
      aria-busy={busy || undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className={cn(
        "relative max-w-0 cursor-pointer px-2 py-1.5 align-middle outline-none focus-visible:ring-2 focus-visible:ring-ring",
        busy && "opacity-60",
        editable && "hover:bg-accent/50",
      )}
    >
      {body}
      {editing && column === "status" && <StatusPicker anchor={ref} current={view.status} onPick={(status) => commit({ status })} onClose={() => end()} />}
      {editing && column === "priority" && <PriorityPicker anchor={ref} current={view.priority} onPick={(priority) => commit({ priority })} onClose={() => end()} />}
      {editing && column === "owner" && (
        <MemberPicker anchor={ref} members={env.members} current={view.ownerId} onPick={(owner_id) => commit({ owner_id })} onClose={() => end()} />
      )}
      {editing && column === "followers" && (
        <MembersMultiPicker
          anchor={ref}
          members={env.members}
          selected={view.task.follower_ids}
          excludeId={view.ownerId}
          max={TASK_LIMITS.followers}
          onCommit={(follower_ids) => onCommit({ follower_ids })}
          onClose={() => end()}
        />
      )}
      {editing && column === "project" && (
        <ProjectPicker anchor={ref} projects={env.projects} current={view.projectKey} onPick={(project) => commit({ project })} onClose={() => end()} />
      )}
    </td>
  );
}

function FollowersDisplay({ ids, names }: { ids: readonly string[]; names: ReadonlyMap<string, string> }) {
  if (ids.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  const shown = ids.slice(0, 3);
  const title = summarizeNames(ids.map((id) => names.get(id) ?? "Alguien del equipo"));
  return (
    <span className="flex items-center" title={title}>
      <span className="flex -space-x-1.5">
        {shown.map((id) => (
          <span key={id} className="rounded-full ring-2 ring-background">
            <Avatar initials={initialsOf(names.get(id) ?? "?")} color={colorOf(id)} userId={id} />
          </span>
        ))}
      </span>
      {ids.length > 3 && <span className="ml-1 text-xs text-muted-foreground">+{ids.length - 3}</span>}
      <span className="sr-only">{ids.length === 1 ? "1 seguidor" : `${ids.length} seguidores`}: {title}</span>
    </span>
  );
}

// ── Editores en el lugar ────────────────────────────────────────────────────

function TitleEditor({
  initial, onCommit, onCancel,
}: {
  initial: string;
  onCommit: (title: string, dir?: 1 | -1) => void;
  onCancel: (dir?: 1 | -1) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  // Una sola salida: Enter, Tab, Esc y el blur no se pisan entre si.
  const finish = (dir?: 1 | -1, cancel = false) => {
    if (done.current) return;
    done.current = true;
    if (cancel || value.trim() === initial.trim()) onCancel(dir);
    else onCommit(value, dir);
  };

  return (
    <input
      ref={ref}
      value={value}
      maxLength={TASK_LIMITS.title}
      aria-label="Título de la tarea"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish()}
      onKeyDown={(e) => {
        const action = cellKeyAction({ key: e.key, shiftKey: e.shiftKey, editing: true });
        if (action === "none") return;
        e.preventDefault();
        if (action === "cancel") finish(undefined, true);
        else if (action === "commit") finish();
        else finish(action === "commit-next" ? 1 : -1);
      }}
      className="h-7 w-full rounded-md border border-primary bg-background px-1.5 text-sm outline-none"
    />
  );
}

function DateEditor({
  initial, initialTime, onCommit, onCancel,
}: {
  initial: string | null;
  initialTime: string | null;
  onCommit: (value: { date: string | null; time: string | null }, dir?: 1 | -1) => void;
  onCancel: (dir?: 1 | -1) => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [time, setTime] = useState(initialTime ?? "");
  // La hora se agrega a proposito: el editor arranca solo con la fecha y ofrece «Agregar hora».
  const [showTime, setShowTime] = useState(!!initialTime);
  const done = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const finish = (dir?: 1 | -1, mode: "auto" | "cancel" | "clear" = "auto") => {
    if (done.current) return;
    done.current = true;
    if (mode === "clear") return onCommit({ date: null, time: null }, dir);
    const nextTime = value && showTime ? time || null : null;
    if (mode === "cancel" || ((value || null) === initial && nextTime === initialTime)) return onCancel(dir);
    onCommit({ date: value || null, time: nextTime }, dir);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const action = cellKeyAction({ key: e.key, shiftKey: e.shiftKey, editing: true });
    if (action === "none") return;
    e.preventDefault();
    if (action === "cancel") finish(undefined, "cancel");
    else if (action === "commit") finish();
    else finish(action === "commit-next" ? 1 : -1);
  };

  return (
    <div
      ref={box}
      className="flex flex-wrap items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        // El foco pasa a otro control del editor (quitar, agregar hora) sin cerrarlo.
        if (box.current && e.relatedTarget && box.current.contains(e.relatedTarget as Node)) return;
        finish();
      }}
    >
      <input
        ref={input}
        type="date"
        value={value}
        aria-label="Fecha de vencimiento"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        className="h-7 min-w-0 flex-1 rounded-md border border-primary bg-background px-1 text-sm outline-none"
      />
      {initial && (
        <button
          type="button"
          aria-label="Quitar la fecha"
          title="Quitar la fecha"
          onClick={() => finish(undefined, "clear")}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {value && !showTime && (
        <button type="button" onClick={() => setShowTime(true)} className="h-7 shrink-0 rounded-md px-1.5 text-xs text-primary hover:bg-accent">
          Agregar hora
        </button>
      )}
      {value && showTime && (
        <>
          <input
            type="time"
            value={time}
            autoFocus={!initialTime}
            aria-label="Hora de vencimiento"
            onChange={(e) => setTime(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-7 w-[6.5rem] shrink-0 rounded-md border border-primary bg-background px-1 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setShowTime(false);
              setTime("");
            }}
            className="h-7 shrink-0 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Quitar hora
          </button>
        </>
      )}
    </div>
  );
}
