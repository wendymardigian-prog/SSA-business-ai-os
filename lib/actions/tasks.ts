"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { memberDisplayName } from "@/lib/workspace-members";
import { createServiceClient } from "@/lib/supabase/server";
import {
  completeTaskCore,
  createTaskCore,
  deleteTaskCore,
  planCompletionCore,
  setTaskBlockersCore,
  updateTaskCore,
  type CompleteOutput,
  type CompletionPlan,
  type TaskCtx,
  type UpdateTaskOutput,
} from "@/lib/tasks/core";
import { fail, type TaskActionResult } from "@/lib/tasks/result";
import type { TaskBlocker, TaskRow } from "@/lib/tasks/types";

/**
 * Acciones de Tareas (Extra A, F8). Una capa fina: pide el permiso, arma el contexto y llama al nucleo
 * (`lib/tasks/core.ts`), que valida con zod y es lo que se prueba. Nunca lanza al cliente.
 *
 * En un archivo "use server" todo lo exportado es una funcion asincronica; los tipos viven en
 * `lib/tasks/result.ts` y `lib/tasks/core.ts`.
 */

const NO_PERMISSION = (what: string) => fail("forbidden", `No tenés permiso para ${what}.`);

async function context(permission: string): Promise<TaskCtx | null> {
  const ctx = await getPermissionAction(permission);
  if (!ctx) return null;
  const service = await createServiceClient();
  return {
    supabase: ctx.supabase,
    service,
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    timeZone: ctx.workspace.timezone || "UTC",
    actorName: memberDisplayName(
      ctx.user.user_metadata?.full_name as string | undefined,
      ctx.user.user_metadata?.name as string | undefined,
      ctx.user.email,
    ),
  };
}

async function run<T>(permission: string, what: string, body: (ctx: TaskCtx) => Promise<TaskActionResult<T>>): Promise<TaskActionResult<T>> {
  try {
    const ctx = await context(permission);
    if (!ctx) return NO_PERMISSION(what);
    const result = await body(ctx);
    if (result.ok) revalidatePath("/dashboard/tareas");
    return result;
  } catch (error) {
    console.error("[tareas] error inesperado:", error instanceof Error ? error.message : String(error));
    return fail("server", "Algo salió mal. Probá de nuevo.");
  }
}

export async function createTask(input: unknown): Promise<TaskActionResult<TaskRow>> {
  return run("tasks.edit", "crear tareas", (ctx) => createTaskCore(ctx, input));
}

export async function updateTask(taskId: string, patch: unknown): Promise<TaskActionResult<UpdateTaskOutput>> {
  return run("tasks.edit", "editar tareas", (ctx) => updateTaskCore(ctx, taskId, patch));
}

/** El plan de fechas para el dialogo de vista previa. No escribe nada. */
export async function planCompletion(taskId: string): Promise<TaskActionResult<CompletionPlan>> {
  return run("tasks.edit", "completar tareas", (ctx) => planCompletionCore(ctx, taskId));
}

/**
 * Completa la tarea. `applyShifts = false` = «completar sin mover fechas». `expected` es lo que devolvio
 * `planCompletion`: si algo cambio desde entonces, responde `stale` y la pantalla recalcula.
 */
export async function completeTask(
  taskId: string,
  applyShifts: boolean,
  expected?: Array<{ task_id: string; updated_at: string }>,
): Promise<TaskActionResult<CompleteOutput>> {
  return run("tasks.edit", "completar tareas", (ctx) => completeTaskCore(ctx, taskId, applyShifts, expected));
}

export async function setTaskBlockers(taskId: string, blockerIds: string[]): Promise<TaskActionResult<TaskBlocker[]>> {
  return run("tasks.edit", "editar tareas", (ctx) => setTaskBlockersCore(ctx, taskId, blockerIds));
}

export async function deleteTask(taskId: string): Promise<TaskActionResult<{ unlinkedFrom: number }>> {
  return run("tasks.delete", "borrar tareas", (ctx) => deleteTaskCore(ctx, taskId));
}
