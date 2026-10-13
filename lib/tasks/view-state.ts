/**
 * El estado de la vista de Tareas, en la URL (Extra A, F14). PURO.
 *
 * Todo lo que la persona elige (filtros, orden, agrupacion, tabla o tablero, la tarea abierta) vive en
 * la URL: se puede compartir un link, volver atras y recargar sin perder nada. `parse` ignora lo
 * invalido; `serialize` omite lo que es el valor por defecto; `parse(serialize(x))` devuelve `x`.
 */

import { TASK_PRIORITIES, TASK_SOURCES, TASK_STATUSES, type TaskPriority, type TaskSource, type TaskStatus } from "./types";

export const VIEW_MODES = ["table", "board"] as const;
export type TasksViewMode = (typeof VIEW_MODES)[number];

export const GROUP_BYS = ["none", "project", "status"] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

export const SORT_COLUMNS = ["title", "status", "owner", "due", "priority", "project", "created"] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

export type SortDir = "asc" | "desc";
export interface SortSpec {
  column: SortColumn;
  dir: SortDir;
}

/** Valores especiales de los filtros de persona y de proyecto. */
export const ME = "me";
export const NONE = "none";

export interface TasksViewState {
  view: TasksViewMode;
  status: TaskStatus[];
  /** ids de personas, `me` (yo) y `none` (sin responsable). */
  owner: string[];
  /** ids de personas y `me`. */
  follower: string[];
  /** claves de proyecto (`project_key`) y `none` (sin proyecto). */
  project: string[];
  priority: TaskPriority[];
  overdue: boolean;
  blocked: boolean;
  source: TaskSource[];
  q: string;
  /** null = el orden por defecto (vencimiento, despues prioridad). */
  sort: SortSpec | null;
  group: GroupBy;
  /** «Mis tareas»: responsable = yo y sin completar. */
  mine: boolean;
  /** La tarea abierta en el drawer. */
  task: string | null;
}

export const DEFAULT_VIEW_STATE: TasksViewState = {
  view: "table",
  status: [],
  owner: [],
  follower: [],
  project: [],
  priority: [],
  overdue: false,
  blocked: false,
  source: [],
  q: "",
  sort: null,
  group: "none",
  mine: false,
  task: null,
};

const ID_SHAPE = /^[0-9a-f][0-9a-f-]{7,63}$/i;
export const MAX_QUERY_LENGTH = 100;
const MAX_PROJECT_KEY = 80;

type Input = URLSearchParams | Record<string, string | string[] | undefined>;

function all(input: Input, key: string): string[] {
  if (input instanceof URLSearchParams) return input.getAll(key);
  const v = input[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function first(input: Input, key: string): string | undefined {
  return all(input, key)[0];
}

const uniq = <T>(list: T[]): T[] => [...new Set(list)];

function oneOf<T extends string>(values: readonly T[], list: string[]): T[] {
  return uniq(list.filter((v): v is T => (values as readonly string[]).includes(v)));
}

function people(list: string[], allowNone: boolean): string[] {
  return uniq(list.filter((v) => v === ME || (allowNone && v === NONE) || ID_SHAPE.test(v)));
}

export function parseViewState(input: Input): TasksViewState {
  const view = first(input, "view");
  const group = first(input, "group");
  const sortRaw = first(input, "sort");
  let sort: SortSpec | null = null;
  if (sortRaw) {
    const [column, dir] = sortRaw.split(":");
    if ((SORT_COLUMNS as readonly string[]).includes(column) && (dir === "asc" || dir === "desc")) {
      sort = { column: column as SortColumn, dir };
    }
  }
  const task = first(input, "task");
  const q = (first(input, "q") ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);

  return {
    view: (VIEW_MODES as readonly string[]).includes(view ?? "") ? (view as TasksViewMode) : "table",
    status: oneOf(TASK_STATUSES, all(input, "status")),
    owner: people(all(input, "owner"), true),
    follower: people(all(input, "follower"), false),
    project: uniq(all(input, "project").filter((v) => v.length > 0 && v.length <= MAX_PROJECT_KEY)),
    priority: oneOf(TASK_PRIORITIES, all(input, "priority")),
    overdue: first(input, "overdue") === "1",
    blocked: first(input, "blocked") === "1",
    source: oneOf(TASK_SOURCES, all(input, "source")),
    q,
    sort,
    group: (GROUP_BYS as readonly string[]).includes(group ?? "") ? (group as GroupBy) : "none",
    mine: first(input, "mine") === "1",
    task: task && ID_SHAPE.test(task) ? task : null,
  };
}

/** Los parametros de la URL; lo que es el valor por defecto no se escribe. */
export function serializeViewState(state: TasksViewState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.view !== "table") p.set("view", state.view);
  for (const v of state.status) p.append("status", v);
  for (const v of state.owner) p.append("owner", v);
  for (const v of state.follower) p.append("follower", v);
  for (const v of state.project) p.append("project", v);
  for (const v of state.priority) p.append("priority", v);
  if (state.overdue) p.set("overdue", "1");
  if (state.blocked) p.set("blocked", "1");
  for (const v of state.source) p.append("source", v);
  if (state.q) p.set("q", state.q);
  if (state.sort) p.set("sort", `${state.sort.column}:${state.sort.dir}`);
  if (state.group !== "none") p.set("group", state.group);
  if (state.mine) p.set("mine", "1");
  if (state.task) p.set("task", state.task);
  return p;
}

/** Cuantos filtros hay puestos (para el globito del boton). El orden y la vista no cuentan. */
export function countActiveFilters(state: TasksViewState): number {
  return (
    (state.status.length > 0 ? 1 : 0) +
    (state.owner.length > 0 ? 1 : 0) +
    (state.follower.length > 0 ? 1 : 0) +
    (state.project.length > 0 ? 1 : 0) +
    (state.priority.length > 0 ? 1 : 0) +
    (state.overdue ? 1 : 0) +
    (state.blocked ? 1 : 0) +
    (state.source.length > 0 ? 1 : 0) +
    (state.q ? 1 : 0) +
    (state.mine ? 1 : 0)
  );
}

/** El estado sin filtros, conservando la vista, el orden, la agrupacion y la tarea abierta. */
export function clearFilters(state: TasksViewState): TasksViewState {
  return {
    ...DEFAULT_VIEW_STATE,
    view: state.view,
    sort: state.sort,
    group: state.group,
    task: state.task,
  };
}

/** Prende o apaga «Mis tareas». */
export function toggleMine(state: TasksViewState): TasksViewState {
  return { ...state, mine: !state.mine };
}
