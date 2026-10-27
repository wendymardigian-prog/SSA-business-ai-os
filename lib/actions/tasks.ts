"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceMembers, memberDisplayName } from "@/lib/workspace-members";
import { loadTeamMemberOptions } from "@/lib/actions/flow-node-options";
import {
  TASK_COLUMNS,
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
import { loadContactTasksChecked, type ContactTasksPayload, type TaskContextPayload } from "@/lib/tasks/contact-section";
import { flowIdOf } from "@/lib/tasks/format";
import { loadTimeFormat } from "@/lib/tasks/time-format";
import { todayInputValue } from "@/lib/dates";
import { createFollowupTaskCore, type FollowupOutput } from "@/lib/tasks/followup-core";
import { fail, success, type TaskActionResult } from "@/lib/tasks/result";
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

/**
 * «Crear tarea» debajo del «Proximo seguimiento» de un contacto (R2): una tarea por contacto y fecha, con un clic.
 * Idempotente: si ya existe devuelve la existente.
 */
export async function createFollowupTask(contactId: string, date: string): Promise<TaskActionResult<FollowupOutput>> {
  return run("tasks.edit", "crear tareas", (ctx) => createFollowupTaskCore(ctx, contactId, date));
}

/**
 * Las personas del equipo que el nodo «Crear tarea» del canvas ofrece como responsable y seguidores. Es la misma lista
 * que «Avisar en la campana»: vive en lib/actions/flow-node-options.ts (`loadTeamMemberOptions`), que no es de Tareas.
 */
export async function loadTaskNodeOptions(): Promise<{ members: Array<{ id: string; name: string }> }> {
  return loadTeamMemberOptions();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tope de tareas que se traen para el contexto del drawer (dependencias, proyectos). */
const CONTEXT_LIMIT = 2000;

/**
 * Las tareas de un contacto para el panel de la bandeja (R1). Lee con la sesion de la persona: la RLS decide cuales ve.
 * Sin `tasks.view` responde `forbidden` y el panel no muestra la seccion.
 */
export async function listContactTasks(contactId: string): Promise<TaskActionResult<ContactTasksPayload>> {
  try {
    const ctx = await getPermissionAction("tasks.view");
    if (!ctx) return NO_PERMISSION("ver tareas");
    if (!UUID.test(contactId)) return fail("validation", "Los datos no son válidos.");
    const { tasks, failed } = await loadContactTasksChecked(ctx.supabase, { workspaceId: ctx.workspace.id, contactId });
    if (failed) return fail("server", "No pude cargar las tareas.");
    const members = await getWorkspaceMembers(ctx.workspace.id);
    const timeZone = ctx.workspace.timezone || "UTC";
    return success({
      tasks,
      members: members.map((m) => ({ id: m.userId, name: m.name })),
      today: todayInputValue(new Date(), timeZone),
      timeZone,
      timeFormat: await loadTimeFormat(ctx.supabase, ctx.workspace.id, ctx.user.id),
      currentUserId: ctx.user.id,
      canEdit: ctx.can("tasks.edit"),
      canDelete: ctx.can("tasks.delete"),
    });
  } catch (error) {
    console.error("[tareas] listContactTasks:", error instanceof Error ? error.message : String(error));
    return fail("server", "No pude cargar las tareas.");
  }
}

/**
 * Todas las tareas que la persona ve (para las dependencias y los proyectos del drawer) con los nombres de sus contactos
 * y flujos de origen. Se pide recien cuando se abre un drawer fuera de la pantalla de Tareas. La RLS decide que ve.
 */
export async function loadTaskContext(): Promise<TaskActionResult<TaskContextPayload>> {
  try {
    const ctx = await getPermissionAction("tasks.view");
    if (!ctx) return NO_PERMISSION("ver tareas");
    const { data, error } = await ctx.supabase
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("workspace_id", ctx.workspace.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(CONTEXT_LIMIT);
    if (error) return fail("server", "No pude cargar las tareas.");
    const tasks = (data ?? []) as unknown as TaskRow[];
    const contactIds = [...new Set(tasks.map((t) => t.contact_id).filter((id): id is string => !!id))];
    const flowIds = [...new Set(tasks.filter((t) => t.source === "flow").map((t) => flowIdOf(t.source_ref)).filter((id): id is string => !!id))];
    const service = await createServiceClient();
    const [contacts, flows] = await Promise.all([
      contactIds.length ? ctx.supabase.from("contacts").select("id, display_name, email").in("id", contactIds) : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; email: string | null }> }),
      flowIds.length ? service.from("flows").select("id, name").eq("workspace_id", ctx.workspace.id).in("id", flowIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    ]);
    return success({
      tasks,
      contactNames: Object.fromEntries((contacts.data ?? []).map((c) => [c.id, c.display_name || c.email || "Sin nombre"])),
      flowNames: Object.fromEntries((flows.data ?? []).map((f) => [f.id, f.name])),
    });
  } catch (error) {
    console.error("[tareas] loadTaskContext:", error instanceof Error ? error.message : String(error));
    return fail("server", "No pude cargar las tareas.");
  }
}
