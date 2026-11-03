/**
 * La lista de contactos: tareas vinculadas al contacto.
 *
 * "Abierta" = no completada y no borrada. Respeta la RLS de `tasks`
 * (`can_see_task`): cada persona cuenta las tareas que ve.
 *
 * Es del módulo Tareas: la plantilla de estudiantes no lo lleva y borra este
 * archivo (`scripts/plantilla/perfiles/estudiantes.mjs`).
 */
import { hasRelatedFilter } from "../filters/catalog";
import { byContact, fillCells, type CellValue, type ContactListModule, type ListClause, type ListGroupDef } from "../filters/types";

export const TASKS_GROUP: ListGroupDef = { key: "tareas", label: "Tareas", order: 85 };

const OPEN: ListClause[] = [
  { op: "is_null", column: "deleted_at" },
  { op: "neq", column: "status", value: "completed" },
];

interface TaskRow {
  contact_id: string;
  due_date: string | null;
  title: string;
}

export const tasksModule: ContactListModule = {
  key: "tareas",
  filters: [
    hasRelatedFilter({
      param: "tareas",
      label: "Tiene tareas abiertas",
      group: TASKS_GROUP,
      relation: "tasks",
      columns: ["status", "deleted_at"],
      clauses: OPEN,
      keywords: "pendiente pendientes",
    }),
  ],
  columns: [
    { key: "open_tasks", label: "Tareas abiertas", group: TASKS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "pendientes" },
    { key: "next_task", label: "Próxima tarea vence", group: TASKS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "vencimiento fecha" },
  ],
  async loadCells(supabase, workspaceId, contactIds, keys) {
    const { data, error } = await supabase
      .from("tasks")
      .select("contact_id, due_date, title")
      .eq("workspace_id", workspaceId)
      .in("contact_id", [...contactIds])
      .is("deleted_at", null)
      .neq("status", "completed")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return taskCells(contactIds, keys, (data ?? []) as TaskRow[]);
  },
};

/** Puro: las celdas a partir de las tareas abiertas de la página (las que vencen antes primero). */
export function taskCells(contactIds: readonly string[], keys: readonly string[], rows: readonly TaskRow[]) {
  const grouped = byContact(rows);
  return fillCells(contactIds, keys, (id) => {
    const list = grouped.get(id) ?? [];
    const next = list.find((t) => t.due_date);
    const cells: Record<string, CellValue> = {
      open_tasks: list.length > 0 ? { t: "number", n: list.length } : null,
      // `due_date` es un día (sin hora): al mediodía UTC se lee igual en América y Europa.
      next_task: next?.due_date ? { t: "date", at: `${next.due_date}T12:00:00Z`, mode: "day", sub: next.title } : null,
    };
    return cells;
  });
}
