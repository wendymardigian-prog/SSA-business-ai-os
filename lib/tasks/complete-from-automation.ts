/**
 * Completar tareas desde una automatizacion (Tareas × CRM, R4): el nodo «Completar tarea» de un flujo.
 *
 * Cierra las tareas ABIERTAS, no borradas, del workspace cuyo `source_ref` es la clave dada. Lo hace como lo haria una
 * persona, pero SIN mover fechas de las dependientes (ni pide confirmacion): `completed_at` (lo pone la base), historial
 * con el sistema como actor, los avisos de siempre (`task_changed`, `task_unblocked`) y el evento `task_completed`.
 *
 * Reglas:
 *  - Sin una clave (`source_ref`) NO hace nada: jamas cierra una tarea que no coincide, asi un flujo no puede cerrar una
 *    tarea manual por error.
 *  - Si no hay tarea que coincida, no hace nada y el flujo sigue.
 *  - NUNCA lanza: todo se atrapa y se registra con `console.error('[tareas] ...')`.
 *  - Es idempotente: cerrar dos veces es lo mismo (la segunda no encuentra tareas abiertas).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { auditAsSystem } from "@/lib/audit";
import { todayInputValue } from "@/lib/dates";
import type { Database } from "@/lib/types/database";
import { emitTaskEvent } from "./automation/emit";
import { TASK_COLUMNS } from "./core";
import { planCompleted, sendTaskNotifications } from "./notifications";
import type { TaskRow } from "./types";

type Db = SupabaseClient<Database>;

export interface CompleteFromAutomationInput {
  workspaceId: string;
  /** La clave que identifica a la(s) tarea(s) a cerrar. Vacia = no hace nada. */
  sourceRef: string;
  actor: { label: string; flowId?: string | null; runId?: string | null; nodeId?: string | null };
}

export type CompleteFromAutomationResult = { ok: true; completed: string[] } | { ok: false; message: string };

export async function completeTasksFromAutomation(db: Db, input: CompleteFromAutomationInput): Promise<CompleteFromAutomationResult> {
  try {
    const ref = (input.sourceRef ?? "").trim();
    if (!ref) return { ok: true, completed: [] };

    const { data: open, error } = await db
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("workspace_id", input.workspaceId)
      .eq("source_ref", ref)
      .is("deleted_at", null)
      .neq("status", "completed");
    if (error) {
      console.error("[tareas] no pude buscar las tareas a completar:", error.message);
      return { ok: false, message: error.message };
    }
    const candidates = (open ?? []) as unknown as TaskRow[];
    if (candidates.length === 0) return { ok: true, completed: [] };

    const { data: ws } = await db.from("workspaces").select("timezone").eq("id", input.workspaceId).maybeSingle();
    const today = todayInputValue(new Date(), ws?.timezone || "UTC");

    // Las que tienen bloqueantes: para saber a quien se libera (se calcula una vez).
    const { data: withBlockers } = await db
      .from("tasks")
      .select("id, title, status, owner_id, blocked_by")
      .eq("workspace_id", input.workspaceId)
      .is("deleted_at", null)
      .filter("blocked_by", "neq", "[]");
    const dependents = (withBlockers ?? []) as unknown as Array<Pick<TaskRow, "id" | "title" | "status" | "owner_id" | "blocked_by">>;
    // El estado de todos los bloqueantes involucrados (para saber si una dependiente queda libre).
    const blockerIds = [...new Set(dependents.flatMap((d) => d.blocked_by.map((b) => b.task_id)))];
    const statusById = new Map<string, TaskRow["status"]>();
    if (blockerIds.length > 0) {
      const { data: blockers } = await db.from("tasks").select("id, status").eq("workspace_id", input.workspaceId).in("id", blockerIds);
      for (const b of (blockers ?? []) as unknown as Array<Pick<TaskRow, "id" | "status">>) statusById.set(b.id, b.status);
    }

    const completed: string[] = [];
    for (const task of candidates) {
      // El candado: solo se completa si sigue abierta (otra ejecucion o una persona pudo adelantarse).
      const { data: done, error: updateError } = await db
        .from("tasks")
        .update({ status: "completed" })
        .eq("id", task.id)
        .eq("workspace_id", input.workspaceId)
        .is("deleted_at", null)
        .neq("status", "completed")
        .select(TASK_COLUMNS)
        .maybeSingle();
      if (updateError) {
        console.error("[tareas] no pude completar la tarea:", updateError.message);
        continue;
      }
      if (!done) continue;
      const row = done as unknown as TaskRow;
      completed.push(row.id);

      await auditAsSystem({
        supabase: db,
        workspaceId: input.workspaceId,
        entityType: "task",
        entityId: row.id,
        action: "task.completed",
        changes: { status: { old: task.status, new: "completed" } },
        metadata: { origin: "flow", source_ref: ref, shifted: 0, ...(input.actor.flowId ? { flow_id: input.actor.flowId } : {}), ...(input.actor.runId ? { run_id: input.actor.runId } : {}), ...(input.actor.nodeId ? { node_id: input.actor.nodeId } : {}) },
        label: input.actor.label,
      });

      // Quien queda libre: todos sus bloqueantes quedaron completados (esta cuenta como hecha).
      statusById.set(row.id, "completed");
      const unblocked = dependents
        .filter((d) => d.status !== "completed" && d.blocked_by.some((b) => b.task_id === row.id))
        .filter((d) => d.blocked_by.every((b) => statusById.get(b.task_id) === "completed"))
        .map((d) => ({ task_id: d.id, title: d.title, owner_id: d.owner_id }));

      try {
        await sendTaskNotifications(db, input.workspaceId, planCompleted({ task: row, moved: [], unblocked }, { id: "", name: input.actor.label }, today));
      } catch (err) {
        console.error("[tareas] no pude avisar de la tarea completada:", err instanceof Error ? err.message : String(err));
      }
      // Como una persona: dispara `task_completed`. No frena nada si falla.
      await emitTaskEvent(db, "task_completed", row, null);
    }
    return { ok: true, completed };
  } catch (err) {
    console.error("[tareas] error al completar tareas desde una automatizacion:", err instanceof Error ? err.message : String(err));
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
