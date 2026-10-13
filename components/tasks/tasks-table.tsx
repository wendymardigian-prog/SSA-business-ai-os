"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsUpDown } from "lucide-react";
import { neighborCell, type CellPatch, type EditableColumn } from "@/lib/tasks/cell-edit";
import { ariaSortOf, type RowGroup, type TaskRowView } from "@/lib/tasks/table-model";
import type { SortColumn, SortSpec } from "@/lib/tasks/view-state";
import { cn } from "@/lib/utils";
import { QuickCreate } from "./quick-create";
import { TaskCell, type CellEnv } from "./task-cells";

type ColumnId = EditableColumn | "blocked" | "source";

interface ColumnDef {
  id: ColumnId;
  header: string;
  sort: SortColumn | null;
  width: string;
}

const COLUMNS: ColumnDef[] = [
  { id: "status", header: "Estado", sort: "status", width: "w-[124px]" },
  { id: "title", header: "Título", sort: "title", width: "w-[280px]" },
  { id: "owner", header: "Responsable", sort: "owner", width: "w-[150px]" },
  { id: "followers", header: "Seguidores", sort: null, width: "w-[96px]" },
  { id: "project", header: "Proyecto", sort: "project", width: "w-[140px]" },
  { id: "due", header: "Vencimiento", sort: "due", width: "w-[124px]" },
  { id: "priority", header: "Prioridad", sort: "priority", width: "w-[104px]" },
  { id: "blocked", header: "Bloqueada", sort: null, width: "w-[84px]" },
  { id: "source", header: "Origen", sort: null, width: "w-[120px]" },
];

const EDITABLE_COUNT = 7;

const helper = createColumnHelper<TaskRowView>();

export interface TasksTableProps {
  groups: RowGroup[];
  env: CellEnv;
  sort: SortSpec | null;
  onSort: (column: SortColumn) => void;
  onOpen: (taskId: string, origin: HTMLElement | null) => void;
  onEdit: (taskId: string, patch: CellPatch) => void;
  /** Crea una tarea con solo el titulo (y el proyecto del grupo). Devuelve si se creo. */
  onQuickCreate: (title: string, project: string | null) => Promise<boolean>;
  busy: ReadonlySet<string>;
  /** Cuantas tareas faltan cargar con «cargar mas». */
  remaining: number;
  onLoadMore: () => void;
  totalShown: number;
}

/**
 * La tabla de tareas (F10, F11). `@tanstack/react-table` arma las columnas y el modelo de filas; el
 * orden, los filtros y la agrupacion ya vienen resueltos de `lib/tasks/*`. Cada celda es editable en su
 * lugar (`task-cells.tsx`).
 */
export function TasksTable({ groups, env, sort, onSort, onOpen, onEdit, onQuickCreate, busy, remaining, onLoadMore, totalShown }: TasksTableProps) {
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const columns = useMemo(
    () => COLUMNS.map((c) => helper.display({ id: c.id, header: c.header, meta: { sort: c.sort, width: c.width } })),
    [],
  );
  // TanStack Table devuelve funciones que el compilador de React no puede memoizar: aca solo se usa para armar las
  // columnas y el modelo de filas, y el resultado no se pasa a hijos memoizados.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: flat, columns, getCoreRowModel: getCoreRowModel(), getRowId: (row) => row.id, manualSorting: true });
  const rowModel = table.getRowModel().rows;
  const rowById = useMemo(() => new Map(rowModel.map((r) => [r.id, r])), [rowModel]);
  const rowIndex = useMemo(() => new Map(flat.map((r, i) => [r.id, i])), [flat]);

  const [editing, setEditing] = useState<{ id: string; col: number } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);

  const focusCell = useCallback((row: number, col: number) => {
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)?.focus());
  }, []);

  const endEdit = useCallback(
    (taskId: string, col: number, dir?: 1 | -1) => {
      setEditing(null);
      if (!dir) return;
      const next = neighborCell({ row: rowIndex.get(taskId) ?? 0, col }, dir, flat.length, COLUMNS.length);
      if (next) focusCell(next.row, next.col);
    },
    [flat.length, focusCell, rowIndex],
  );

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const grouped = groups.length > 1 || groups[0]?.key !== "all";

  return (
    <div ref={root} className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[1120px] table-fixed border-collapse text-left">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const meta = h.column.columnDef.meta as { sort: SortColumn | null; width: string };
                const Icon = !meta.sort ? null : sort?.column === meta.sort ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
                return (
                  <th key={h.id} scope="col" aria-sort={meta.sort ? ariaSortOf(sort, meta.sort) : undefined} className={cn("px-2 py-2 font-medium", meta.width)}>
                    {meta.sort ? (
                      <button type="button" onClick={() => onSort(meta.sort as SortColumn)} className="inline-flex items-center gap-1 rounded hover:text-foreground">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {Icon && <Icon className="h-3 w-3" aria-hidden />}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {groups.map((group) => {
            const isCollapsed = grouped && collapsed.has(group.key);
            return (
              <GroupBlock key={group.key}>
                {grouped && (
                  <tr className="bg-muted/30">
                    <td colSpan={COLUMNS.length} className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        aria-expanded={!isCollapsed}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold"
                      >
                        {isCollapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                        {group.label}
                        <span className="rounded-full bg-muted px-1.5 text-[11px] font-normal text-muted-foreground">{group.rows.length}</span>
                      </button>
                    </td>
                  </tr>
                )}
                {!isCollapsed &&
                  group.rows.map((view) => {
                    const row = rowById.get(view.id);
                    if (!row) return null;
                    const ri = rowIndex.get(view.id) ?? 0;
                    return (
                      <tr key={view.id} data-task-row={view.id} className="border-t border-border/70 hover:bg-accent/30">
                        {row.getVisibleCells().map((cell, ci) => {
                          const id = cell.column.id as ColumnId;
                          return (
                            <TaskCell
                              key={cell.id}
                              view={view}
                              column={id}
                              env={env}
                              position={{ row: ri, col: ci }}
                              editing={editing?.id === view.id && editing.col === ci}
                              busy={busy.has(view.id)}
                              onStartEdit={() => ci < EDITABLE_COUNT && setEditing({ id: view.id, col: ci })}
                              onEndEdit={(dir) => endEdit(view.id, ci, dir)}
                              onCommit={(patch) => onEdit(view.id, patch)}
                              onOpen={() => onOpen(view.id, root.current?.querySelector<HTMLElement>(`[data-task-row="${view.id}"] [data-column="title"]`) ?? null)}
                            />
                          );
                        })}
                      </tr>
                    );
                  })}
                {!isCollapsed && env.canEdit && (
                  <tr className="border-t border-border/70">
                    <td colSpan={COLUMNS.length} className="px-2 py-1">
                      <QuickCreate project={group.project} onCreate={onQuickCreate} />
                    </td>
                  </tr>
                )}
              </GroupBlock>
            );
          })}
        </tbody>
      </table>
      {remaining > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/20 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Mostrando {totalShown} de {totalShown + remaining} tareas.</span>
          <button type="button" onClick={onLoadMore} className="h-8 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            Cargar {Math.min(100, remaining)} más
          </button>
        </div>
      )}
    </div>
  );
}

/** Varias filas hermanas dentro de un <tbody>: solo para poder ponerles una `key` en conjunto. */
function GroupBlock({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
