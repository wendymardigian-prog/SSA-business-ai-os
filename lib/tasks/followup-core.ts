/**
 * Crear la tarea de seguimiento de un contacto (Tareas × CRM, R2). El nucleo de la accion `createFollowupTask`.
 *
 * Reglas:
 *  - El contacto tiene que verse con la sesion de la persona (la RLS decide).
 *  - Se escribe con el cliente de servicio porque `source` y `source_ref` no son escribibles por la sesion; el permiso
 *    (`tasks.edit`) y la visibilidad del contacto se chequean ANTES.
 *  - Idempotente: el indice unico `uq_tasks_followup` (00206) garantiza una sola tarea por contacto y fecha. Si ya hay una
 *    (dos clics, dos personas a la vez), se devuelve la existente. Si existe pero la persona no la puede ver, se le dice
 *    sin filtrar nada de ella.
 *  - Nunca lanza.
 */

import { diffFields, logAudit } from "@/lib/audit";
import { TASK_COLUMNS, type TaskCtx } from "./core";
import { isDateOnly } from "./dates";
import { buildFollowupTask, followupRef } from "./followup";
import { fail, success, type TaskActionResult } from "./result";
import type { TaskRow } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FollowupOutput {
  task: TaskRow;
  /** `true` si ya existia (no se creo una nueva). */
  existing: boolean;
}

export async function createFollowupTaskCore(ctx: TaskCtx, contactId: string, date: string): Promise<TaskActionResult<FollowupOutput>> {
  try {
    if (!UUID.test(contactId) || !isDateOnly(date)) return fail("validation", "Los datos no son válidos.");

    const { data: contact } = await ctx.supabase
      .from("contacts")
      .select("id, display_name, email")
      .eq("id", contactId)
      .eq("workspace_id", ctx.workspaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!contact) return fail("validation", "No encontramos ese contacto.");

    const ref = followupRef(date);

    // La existente (si la hay) y si esta persona la puede ver.
    const existing = async (): Promise<TaskActionResult<FollowupOutput> | null> => {
      const { data } = await ctx.service
        .from("tasks")
        .select("id")
        .eq("workspace_id", ctx.workspaceId)
        .eq("contact_id", contactId)
        .eq("source_ref", ref)
        .is("deleted_at", null)
        .maybeSingle();
      if (!data) return null;
      const { data: visible } = await ctx.supabase.from("tasks").select(TASK_COLUMNS).eq("id", (data as { id: string }).id).is("deleted_at", null).maybeSingle();
      if (!visible) return fail("conflict", "Ya hay una tarea de seguimiento para esa fecha.");
      return success({ task: visible as unknown as TaskRow, existing: true });
    };

    const already = await existing();
    if (already) return already;

    const draft = buildFollowupTask(contact as { id: string; display_name: string | null; email: string | null }, date, ctx.userId);
    const { data, error } = await ctx.service
      .from("tasks")
      .insert({ ...draft, workspace_id: ctx.workspaceId, created_by: ctx.userId, status: "pending", priority: "normal" })
      .select(TASK_COLUMNS)
      .single();

    if (error || !data) {
      // Otra persona (u otro clic) la creo justo antes: el indice unico lo atajo.
      if (error?.code === "23505") {
        const raced = await existing();
        if (raced) return raced;
      }
      console.error("[tareas] no pude crear el seguimiento:", error?.message);
      return fail("server", "No pude crear la tarea. Probá de nuevo.");
    }
    const task = data as unknown as TaskRow;

    await logAudit({
      supabase: ctx.supabase,
      workspaceId: ctx.workspaceId,
      entityType: "task",
      entityId: task.id,
      action: "task.created",
      changes: diffFields({}, { title: task.title, due_date: task.due_date, owner_id: task.owner_id, contact_id: task.contact_id, status: task.status, priority: task.priority }),
      metadata: { source_ref: ref, origin: "followup" },
      performedBy: ctx.userId,
    });

    return success({ task, existing: false });
  } catch (error) {
    console.error("[tareas] createFollowupTask:", error instanceof Error ? error.message : String(error));
    return fail("server", "No pude crear la tarea. Probá de nuevo.");
  }
}
