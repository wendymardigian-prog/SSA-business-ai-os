/**
 * El modelo de la tabla de Tareas (Extra A, F10). PURO: los componentes solo lo dibujan.
 */

import { foldText } from "./text";
import { PRIORITY_RANK, STATUS_LABELS, TASK_STATUSES, type TaskRow, type TaskSource, type TaskStatus } from "./types";
import type { GroupBy, SortColumn, SortSpec } from "./view-state";

export interface MemberLite {
  id: string;
  name: string;
}

export interface TaskRowView {
  id: string;
  task: TaskRow;
  title: string;
  status: TaskStatus;
  ownerId: string | null;
  ownerName: string | null;
  followerCount: number;
  /** El nombre del proyecto como se escribio la primera vez. */
  project: string | null;
  projectKey: string | null;
  dueDate: string | null;
  priority: TaskRow["priority"];
  overdue: boolean;
  blocked: boolean;
  /** Cuantos bloqueantes siguen sin completarse. */
  blockedCount: number;
  source: TaskSource;
  contactId: string | null;
}

/** Vencida = vence antes de hoy y no esta completada. */
export function isOverdue(task: Pick<TaskRow, "due_date" | "status">, today: string): boolean {
  return task.due_date !== null && task.due_date < today && task.status !== "completed";
}

/** Cuantos de sus bloqueantes siguen abiertos. Un bloqueante que no se conoce (no se ve) no cuenta. */
export function openBlockers(task: Pick<TaskRow, "blocked_by">, byId: ReadonlyMap<string, Pick<TaskRow, "status">>): number {
  let n = 0;
  for (const b of task.blocked_by ?? []) {
    const blocker = byId.get(b.task_id);
    if (blocker && blocker.status !== "completed") n += 1;
  }
  return n;
}

export function isBlocked(task: Pick<TaskRow, "blocked_by">, byId: ReadonlyMap<string, Pick<TaskRow, "status">>): boolean {
  return openBlockers(task, byId) > 0;
}

export function buildRows(
  tasks: readonly TaskRow[],
  members: readonly MemberLite[],
  opts: { today: string; byId?: ReadonlyMap<string, TaskRow> },
): TaskRowView[] {
  const names = new Map(members.map((m) => [m.id, m.name]));
  const byId = opts.byId ?? new Map(tasks.map((t) => [t.id, t]));
  return tasks.map((task) => {
    const blockedCount = openBlockers(task, byId);
    return {
      id: task.id,
      task,
      title: task.title,
      status: task.status,
      ownerId: task.owner_id,
      ownerName: task.owner_id ? (names.get(task.owner_id) ?? null) : null,
      followerCount: task.follower_ids.length,
      project: task.project,
      projectKey: task.project_key,
      dueDate: task.due_date,
      priority: task.priority,
      overdue: isOverdue(task, opts.today),
      blocked: blockedCount > 0,
      blockedCount,
      source: task.source,
      contactId: task.contact_id,
    };
  });
}

// ── Orden ───────────────────────────────────────────────────────────────────

const STATUS_RANK: Record<TaskStatus, number> = { pending: 0, in_progress: 1, completed: 2 };

/** Los nulos van siempre al final, en los dos sentidos. */
function cmpNullable<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return cmp(a, b) * dir;
}

const text = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });

function byColumn(column: SortColumn, dir: 1 | -1): (a: TaskRowView, b: TaskRowView) => number {
  switch (column) {
    case "title":
      return (a, b) => text(a.title, b.title) * dir;
    case "status":
      return (a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * dir;
    case "owner":
      return (a, b) => cmpNullable(a.ownerName, b.ownerName, text, dir);
    case "due":
      return (a, b) => cmpNullable(a.dueDate, b.dueDate, (x, y) => (x < y ? -1 : x > y ? 1 : 0), dir);
    case "priority":
      return (a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * dir;
    case "project":
      return (a, b) => cmpNullable(a.project, b.project, text, dir);
    case "created":
      return (a, b) => (a.task.created_at < b.task.created_at ? -1 : a.task.created_at > b.task.created_at ? 1 : 0) * dir;
  }
}

/**
 * Orden estable. Sin `sort`: vencimiento ascendente (las sin fecha al final) y, a igual fecha, la mas
 * urgente primero. Con `sort`, esa columna y, para desempatar, el orden por defecto.
 */
export function sortRows(rows: readonly TaskRowView[], sort: SortSpec | null): TaskRowView[] {
  const fallback = [byColumn("due", 1), (a: TaskRowView, b: TaskRowView) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority], byColumn("created", 1)];
  const chain = sort ? [byColumn(sort.column, sort.dir === "asc" ? 1 : -1), ...fallback] : fallback;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      for (const cmp of chain) {
        const r = cmp(x.row, y.row);
        if (r !== 0) return r;
      }
      return x.index - y.index;
    })
    .map((x) => x.row);
}

// ── Agrupar ─────────────────────────────────────────────────────────────────

export interface RowGroup {
  key: string;
  label: string;
  rows: TaskRowView[];
  /** Para crear una tarea nueva dentro del grupo: el proyecto del grupo, si es de proyecto. */
  project: string | null;
}

export const NO_PROJECT_LABEL = "Sin proyecto";

/** Los grupos conservan el orden que traen las filas. «Sin proyecto» va ultimo. */
export function groupRows(rows: readonly TaskRowView[], group: GroupBy): RowGroup[] {
  if (group === "none") return [{ key: "all", label: "", rows: [...rows], project: null }];

  if (group === "status") {
    return TASK_STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s], rows: rows.filter((r) => r.status === s), project: null }))
      .filter((g) => g.rows.length > 0);
  }

  const groups = new Map<string, RowGroup>();
  const none: RowGroup = { key: NO_PROJECT_KEY, label: NO_PROJECT_LABEL, rows: [], project: null };
  for (const row of rows) {
    if (!row.projectKey || !row.project) {
      none.rows.push(row);
      continue;
    }
    const g = groups.get(row.projectKey) ?? { key: row.projectKey, label: row.project, rows: [], project: row.project };
    g.rows.push(row);
    groups.set(row.projectKey, g);
  }
  const named = [...groups.values()].sort((a, b) => text(foldText(a.label), foldText(b.label)));
  return none.rows.length > 0 ? [...named, none] : named;
}

export const NO_PROJECT_KEY = "__sin_proyecto__";

// ── Paginacion ──────────────────────────────────────────────────────────────

export const INITIAL_PAGE = 500;
export const PAGE_STEP = 100;

/** Cuantas filas se muestran: hasta 500 sin paginar; despues «cargar mas» de 100 en 100. */
export function visibleLimit(total: number, loadedMore: number): number {
  return Math.min(total, INITIAL_PAGE + loadedMore * PAGE_STEP);
}

export function remainingToLoad(total: number, loadedMore: number): number {
  return Math.max(0, total - visibleLimit(total, loadedMore));
}

// ── Encabezados ─────────────────────────────────────────────────────────────

/** Apretar un encabezado: ascendente, despues descendente, despues el orden por defecto. */
export function nextSort(current: SortSpec | null, column: SortColumn): SortSpec | null {
  if (!current || current.column !== column) return { column, dir: "asc" };
  if (current.dir === "asc") return { column, dir: "desc" };
  return null;
}

/** Para `aria-sort` del encabezado de una columna. */
export function ariaSortOf(current: SortSpec | null, column: SortColumn): "ascending" | "descending" | "none" {
  if (!current || current.column !== column) return "none";
  return current.dir === "asc" ? "ascending" : "descending";
}
