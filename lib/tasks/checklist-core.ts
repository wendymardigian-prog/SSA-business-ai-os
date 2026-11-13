/**
 * Tildar, sumar o sacar un punto del checklist de una tarea (Servicios A4, F153). El checklist lo escribe solo el
 * servidor (00368): primero la SESIÓN reescribe un campo sin cambiarlo, así la RLS dice si la persona puede editar la
 * tarea; recién después el cliente de servicio guarda el checklist, condicionado a que la tarea no haya cambiado.
 */
import { randomUUID } from "node:crypto";
import { addChecklistItem, readChecklist, removeChecklistItem, toggleChecklistItem, type ChecklistItem } from "./checklist";
import { fail, FORBIDDEN_MESSAGE, success, type TaskActionResult } from "./result";
import type { TaskCtx } from "./core";

export type ChecklistOp = { type: "add"; text: string } | { type: "toggle"; id: string; done: boolean } | { type: "remove"; id: string };

export async function checklistOpCore(ctx: TaskCtx, taskId: string, op: ChecklistOp, now: () => Date = () => new Date()): Promise<TaskActionResult<ChecklistItem[]>> {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return fail("validation", "Los datos no son válidos.");
  const { data: probe, error: probeErr } = await ctx.supabase
    .from("tasks")
    .select("id, title, checklist, updated_at")
    .eq("id", taskId)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (probeErr || !probe) return fail("forbidden", FORBIDDEN_MESSAGE);
  const row = probe as { id: string; title: string; checklist: unknown; updated_at: string };
  const { data: editable } = await ctx.supabase.from("tasks").update({ title: row.title }).eq("id", taskId).eq("workspace_id", ctx.workspaceId).select("updated_at").maybeSingle();
  if (!editable) return fail("forbidden", "No tenés permiso para editar esta tarea.");

  const list = readChecklist(row.checklist);
  let next: ChecklistItem[];
  if (op.type === "add") {
    const r = addChecklistItem(list, op.text, randomUUID);
    if (!r.ok) return fail("validation", r.error);
    next = r.list;
  } else if (op.type === "toggle") {
    if (!list.some((x) => x.id === op.id)) return fail("validation", "Ese punto ya no está.");
    next = toggleChecklistItem(list, op.id, op.done, ctx.userId, now().toISOString());
  } else {
    next = removeChecklistItem(list, op.id);
  }
  const { data, error } = await ctx.service
    .from("tasks")
    .update({ checklist: next } as never)
    .eq("id", taskId)
    .eq("workspace_id", ctx.workspaceId)
    .eq("updated_at", (editable as { updated_at: string }).updated_at)
    .select("checklist")
    .maybeSingle();
  if (error) {
    console.error("[tareas] no pude guardar el checklist:", error.message);
    return fail("server", "No se pudo guardar el checklist. Probá de nuevo.");
  }
  if (!data) return fail("validation", "Alguien cambió la tarea al mismo tiempo. Volvé a intentarlo.");
  return success(readChecklist((data as { checklist: unknown }).checklist));
}
