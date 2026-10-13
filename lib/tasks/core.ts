/**
 * El nucleo de las acciones de Tareas (Extra A, F4 a F8).
 *
 * Recibe los clientes ya armados (el de la persona, que respeta la RLS, y el de servicio, para lo que
 * una persona no puede escribir o leer: `blocked_by`, quienes son miembros), asi `lib/actions/tasks.ts`
 * queda como una capa fina de permisos y este archivo se prueba con una base falsa o con la real
 * (`scripts/verify-tasks.mjs`).
 *
 * Reglas que se repiten en la base (la base manda):
 *  - Toda mutacion se valida en el servidor con zod aunque el cliente ya lo haya hecho.
 *  - Una tarea que no existe y una que no se puede ver dan EL MISMO error: no se filtra nada.
 *  - Nunca lanza: devuelve `{ ok, data }` o `{ ok:false, error, code }`.
 *  - Auditar o avisar nunca hace fallar la operacion.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { diffFields, logAudit } from "@/lib/audit";
import { todayInputValue } from "@/lib/dates";
import type { Database, Json } from "@/lib/types/database";
import { dateOfInstant } from "./dates";
import { planCompleted, planCreated, planUpdated, sendTaskNotifications, type TaskNotice } from "./notifications";
import { computeDateShifts, type DateRuleTask, type DateShift } from "./date-rules";
import { BLOCKER_ERROR_MESSAGES, regapForNewDue, type BlockerErrorCode } from "./dependencies";
import { fail, FORBIDDEN_MESSAGE, success, type TaskActionResult } from "./result";
import { createTaskSchema, parseWith, taskIdSchema, updateTaskSchema } from "./schema";
import type { TaskBlocker, TaskRow } from "./types";

type Db = SupabaseClient<Database>;

export interface TaskCtx {
  /** El cliente DE LA PERSONA: la RLS decide que ve y que escribe. */
  supabase: Db;
  /** El cliente de servicio: solo para lo que la persona no puede tocar directo. */
  service: Db;
  workspaceId: string;
  userId: string;
  /** `workspaces.timezone`: las fechas de las tareas son de esa zona. */
  timeZone: string;
  /** Como se llama quien actua, para los avisos («María te asignó…»). */
  actorName?: string;
}

const actorOf = (ctx: TaskCtx) => ({ id: ctx.userId, name: ctx.actorName || "Alguien del equipo" });

/** Los avisos nunca tumban la operacion: ni armarlos ni escribirlos. */
async function notify(ctx: TaskCtx, build: () => TaskNotice[]): Promise<void> {
  try {
    await sendTaskNotifications(ctx.service, ctx.workspaceId, build());
  } catch (error) {
    console.error("[tareas] no pude armar los avisos:", error instanceof Error ? error.message : String(error));
  }
}

export const TASK_COLUMNS =
  "id, workspace_id, title, description, status, priority, start_date, due_date, completed_at, owner_id, follower_ids, project, project_key, blocked_by, contact_id, conversation_id, source, source_ref, position, created_by, created_at, updated_at, deleted_at";

/** Lo que de una tarea se audita cuando cambia. */
const AUDITED_FIELDS = [
  "title", "description", "status", "priority", "start_date", "due_date",
  "owner_id", "follower_ids", "project", "contact_id", "conversation_id",
] as const;

const auditView = (t: Partial<TaskRow>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const f of AUDITED_FIELDS) {
    const v = t[f];
    out[f] = Array.isArray(v) ? [...v].sort().join(",") : v;
  }
  return out;
};

function mapDbError(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("task_invalid_owner")) return "El responsable tiene que ser parte del equipo.";
  if (m.includes("task_invalid_follower")) return "Los seguidores tienen que ser parte del equipo.";
  if (m.includes("task_invalid_contact")) return "Ese contacto no es de este negocio.";
  if (m.includes("task_invalid_conversation")) return "Esa conversación no es de este negocio.";
  return "No pude guardar la tarea. Probá de nuevo.";
}

async function membersAmong(ctx: TaskCtx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await ctx.service
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", ctx.workspaceId)
    .in("user_id", ids);
  return new Set((data ?? []).map((r) => r.user_id));
}

/** Responsable y seguidores: solo gente del equipo. Devuelve un mensaje si algo no cierra. */
async function checkPeople(ctx: TaskCtx, ownerId: string | null | undefined, followerIds: string[] | undefined): Promise<string | null> {
  const wanted = [...(ownerId ? [ownerId] : []), ...(followerIds ?? [])];
  if (wanted.length === 0) return null;
  const found = await membersAmong(ctx, [...new Set(wanted)]);
  if (ownerId && !found.has(ownerId)) return "El responsable tiene que ser parte del equipo.";
  if ((followerIds ?? []).some((id) => !found.has(id))) return "Los seguidores tienen que ser parte del equipo.";
  return null;
}

/** El contacto y la conversacion tienen que verse con la sesion de la persona (la RLS decide). */
async function checkLinks(ctx: TaskCtx, contactId: string | null | undefined, conversationId: string | null | undefined): Promise<string | null> {
  if (contactId) {
    const { data } = await ctx.supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("workspace_id", ctx.workspaceId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) return "No encontramos ese contacto.";
  }
  if (conversationId) {
    const { data } = await ctx.supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();
    if (!data) return "No encontramos esa conversación.";
  }
  return null;
}

async function loadVisibleTask(ctx: TaskCtx, taskId: string): Promise<TaskRow | null> {
  const { data } = await ctx.supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("id", taskId)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as unknown as TaskRow | null) ?? null;
}

// ── Crear ───────────────────────────────────────────────────────────────────

export async function createTaskCore(ctx: TaskCtx, raw: unknown): Promise<TaskActionResult<TaskRow>> {
  const parsed = parseWith(createTaskSchema, raw);
  if (!parsed.ok) return fail("validation", parsed.error);
  const input = parsed.data;

  // Por defecto el responsable es quien la crea; `null` explicito = sin responsable.
  const ownerId = input.owner_id === undefined ? ctx.userId : input.owner_id;
  const followers = (input.follower_ids ?? []).filter((id) => id !== ownerId);

  const peopleError = await checkPeople(ctx, ownerId, followers);
  if (peopleError) return fail("validation", peopleError);
  const linkError = await checkLinks(ctx, input.contact_id, input.conversation_id);
  if (linkError) return fail("validation", linkError);

  const row = {
    workspace_id: ctx.workspaceId,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? "pending",
    priority: input.priority ?? "normal",
    start_date: input.start_date ?? null,
    due_date: input.due_date ?? null,
    owner_id: ownerId,
    follower_ids: followers,
    project: input.project?.project ?? null,
    project_key: input.project?.project_key ?? null,
    contact_id: input.contact_id ?? null,
    conversation_id: input.conversation_id ?? null,
    created_by: ctx.userId,
  };

  const { data, error } = await ctx.supabase.from("tasks").insert(row).select(TASK_COLUMNS).single();
  if (error || !data) {
    console.error("[tareas] no pude crear la tarea:", error?.message);
    return fail(error?.code === "42501" ? "forbidden" : "validation", error?.code === "42501" ? "No tenés permiso para crear tareas." : mapDbError(error?.message));
  }
  const task = data as unknown as TaskRow;

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspaceId,
    entityType: "task",
    entityId: task.id,
    action: "task.created",
    changes: diffFields({}, auditView(task)),
    performedBy: ctx.userId,
  });

  await notify(ctx, () => planCreated(task, actorOf(ctx)));

  return success(task);
}

// ── Editar ──────────────────────────────────────────────────────────────────

export interface UpdateTaskOutput {
  before: TaskRow;
  after: TaskRow;
}

export async function updateTaskCore(ctx: TaskCtx, taskId: string, raw: unknown): Promise<TaskActionResult<UpdateTaskOutput>> {
  const idParsed = parseWith(taskIdSchema, taskId);
  if (!idParsed.ok) return fail("validation", "Los datos no son válidos.");
  const parsed = parseWith(updateTaskSchema, raw);
  if (!parsed.ok) return fail("validation", parsed.error);
  const patch = parsed.data;

  // Completar tiene su propio camino: puede arrastrar fechas de otras tareas.
  if (patch.status === "completed") {
    return fail("use_complete", "Para completar una tarea usá «Completar».");
  }

  const before = await loadVisibleTask(ctx, taskId);
  if (!before) return fail("forbidden", FORBIDDEN_MESSAGE);

  const peopleError = await checkPeople(
    ctx,
    patch.owner_id !== undefined && patch.owner_id !== before.owner_id ? patch.owner_id : undefined,
    patch.follower_ids?.filter((id) => !before.follower_ids.includes(id)),
  );
  if (peopleError) return fail("validation", peopleError);
  const linkError = await checkLinks(
    ctx,
    patch.contact_id !== undefined && patch.contact_id !== before.contact_id ? patch.contact_id : undefined,
    patch.conversation_id !== undefined && patch.conversation_id !== before.conversation_id ? patch.conversation_id : undefined,
  );
  if (linkError) return fail("validation", linkError);

  const nextStart = patch.start_date !== undefined ? patch.start_date : before.start_date;
  const nextDue = patch.due_date !== undefined ? patch.due_date : before.due_date;
  if (nextStart && nextDue && nextStart > nextDue) {
    return fail("validation", "La fecha de inicio no puede ser posterior al vencimiento.");
  }

  // Cambiar el vencimiento de una tarea bloqueada: no puede quedar antes que su bloqueante.
  let regapped: TaskBlocker[] | null = null;
  if (patch.due_date !== undefined && patch.due_date !== before.due_date && before.blocked_by.length > 0) {
    const { data: blockerRows } = await ctx.service
      .from("tasks")
      .select("id, due_date")
      .in("id", before.blocked_by.map((b) => b.task_id));
    const dueById = new Map((blockerRows ?? []).map((r) => [r.id, r.due_date as string | null]));
    const regap = regapForNewDue(before.blocked_by, patch.due_date, dueById);
    if (!regap.ok) return fail("date_before_blocker", BLOCKER_ERROR_MESSAGES.date_before_blocker);
    regapped = regap.blockers;
  }

  const { project, ...rest } = patch;
  const update: Record<string, unknown> = { ...rest };
  if (project !== undefined) {
    update.project = project.project;
    update.project_key = project.project_key;
  }
  // El responsable no puede quedar tambien como seguidor.
  const finalOwner = patch.owner_id !== undefined ? patch.owner_id : before.owner_id;
  const finalFollowers = patch.follower_ids ?? before.follower_ids;
  if (patch.owner_id !== undefined || patch.follower_ids !== undefined) {
    update.follower_ids = finalFollowers.filter((id) => id !== finalOwner);
  }

  const { data, error } = await ctx.supabase
    .from("tasks")
    .update(update)
    .eq("id", taskId)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .select(TASK_COLUMNS)
    .maybeSingle();
  if (error) {
    console.error("[tareas] no pude actualizar la tarea:", error.message);
    return fail("validation", mapDbError(error.message));
  }
  if (!data) return fail("forbidden", FORBIDDEN_MESSAGE);
  let after = data as unknown as TaskRow;

  if (regapped) {
    const { data: regapRow } = await ctx.service
      .from("tasks")
      .update({ blocked_by: regapped as unknown as Json })
      .eq("id", taskId)
      .select(TASK_COLUMNS)
      .maybeSingle();
    if (regapRow) after = regapRow as unknown as TaskRow;
  }

  const changes = diffFields(auditView(before), auditView(after));
  if (changes) {
    const reopened = before.status === "completed" && after.status !== "completed";
    await logAudit({
      supabase: ctx.supabase,
      workspaceId: ctx.workspaceId,
      entityType: "task",
      entityId: taskId,
      action: reopened ? "task.reopened" : "task.updated",
      changes,
      performedBy: ctx.userId,
    });
  }

  await notify(ctx, () => planUpdated(before, after, actorOf(ctx), todayInputValue(new Date(), ctx.timeZone)));

  return success({ before, after });
}

// ── Completar (con el plan de fechas) ───────────────────────────────────────

const PLAN_COLUMNS = "id, title, status, due_date, start_date, completed_at, blocked_by, owner_id, follower_ids, updated_at";
type PlanRow = Pick<TaskRow, "id" | "title" | "status" | "due_date" | "start_date" | "completed_at" | "blocked_by" | "owner_id" | "follower_ids" | "updated_at">;

export interface PlannedShift extends DateShift {
  title: string;
  blockerTitle: string;
}

export interface CompletionPlan {
  taskId: string;
  title: string;
  /** AAAA-MM-DD: hoy en la zona del workspace. */
  completedOn: string;
  shifts: PlannedShift[];
  /** El `updated_at` (tal cual lo dio la base) de la tarea y de cada tarea afectada. */
  expected: Array<{ task_id: string; updated_at: string }>;
}

/**
 * El plan para completar `taskId`. Se arma SOLO con las tareas que la persona ve (la RLS): una
 * dependiente que no ve no se mueve ni se le filtra el titulo.
 */
async function buildPlan(ctx: TaskCtx, taskId: string): Promise<{ plan: CompletionPlan; root: PlanRow; rows: PlanRow[] } | null> {
  const { data: rootData } = await ctx.supabase
    .from("tasks")
    .select(PLAN_COLUMNS)
    .eq("id", taskId)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  const root = rootData as unknown as PlanRow | null;
  if (!root) return null;

  // Todo lo que tiene bloqueantes (las posibles dependientes)...
  const { data: withBlockers } = await ctx.supabase
    .from("tasks")
    .select(PLAN_COLUMNS)
    .eq("workspace_id", ctx.workspaceId)
    .is("deleted_at", null)
    .filter("blocked_by", "neq", "[]");
  const byId = new Map<string, PlanRow>();
  byId.set(root.id, root);
  for (const r of (withBlockers ?? []) as unknown as PlanRow[]) byId.set(r.id, r);

  // ...y los bloqueantes que no estan en la lista (para saber su fecha).
  const missing = new Set<string>();
  for (const r of byId.values()) for (const b of r.blocked_by ?? []) if (!byId.has(b.task_id)) missing.add(b.task_id);
  if (missing.size > 0) {
    const { data: extra } = await ctx.supabase
      .from("tasks")
      .select(PLAN_COLUMNS)
      .eq("workspace_id", ctx.workspaceId)
      .is("deleted_at", null)
      .in("id", [...missing]);
    for (const r of (extra ?? []) as unknown as PlanRow[]) byId.set(r.id, r);
  }

  const rows = [...byId.values()];
  const completedOn = todayInputValue(new Date(), ctx.timeZone);
  const ruleTasks: DateRuleTask[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    due_date: r.due_date,
    start_date: r.start_date,
    completed_on: r.completed_at ? dateOfInstant(r.completed_at, ctx.timeZone) : null,
    blocked_by: r.blocked_by ?? [],
  }));
  const { shifts } = computeDateShifts({ tasks: ruleTasks, completedTaskId: taskId, completedOn });

  const plan: CompletionPlan = {
    taskId,
    title: root.title,
    completedOn,
    shifts: shifts.map((s) => ({
      ...s,
      title: byId.get(s.taskId)?.title ?? "",
      blockerTitle: byId.get(s.blockerId)?.title ?? "",
    })),
    expected: [root, ...shifts.map((s) => byId.get(s.taskId) as PlanRow)].map((r) => ({ task_id: r.id, updated_at: r.updated_at })),
  };
  return { plan, root, rows };
}

export async function planCompletionCore(ctx: TaskCtx, taskId: string): Promise<TaskActionResult<CompletionPlan>> {
  if (!parseWith(taskIdSchema, taskId).ok) return fail("validation", "Los datos no son válidos.");
  const built = await buildPlan(ctx, taskId);
  if (!built) return fail("forbidden", FORBIDDEN_MESSAGE);
  return success(built.plan);
}

export interface CompleteOutput {
  task: PlanRow;
  shifted: Array<{ task_id: string; from_due: string; to_due: string }>;
  /** Dependientes que quedaron sin ningun bloqueante pendiente. */
  unblocked: Array<{ task_id: string; title: string; owner_id: string | null }>;
  /** Las filas de las tareas movidas, para avisar a su responsable y seguidores. */
  movedRows: PlanRow[];
}

const RPC_ERRORS: Record<string, { code: "stale" | "forbidden" | "conflict" | "validation"; message: string }> = {
  stale: { code: "stale", message: "Alguien modificó una de las tareas mientras tanto. Revisá las fechas nuevas." },
  forbidden: { code: "forbidden", message: FORBIDDEN_MESSAGE },
  not_found: { code: "forbidden", message: FORBIDDEN_MESSAGE },
  already_completed: { code: "conflict", message: "Esa tarea ya está completada." },
  invalid_shift: { code: "conflict", message: "Las fechas propuestas ya no son válidas. Revisalas de nuevo." },
};

/**
 * Completa la tarea. El plan se recalcula ACA (el cliente nunca manda fechas); si `expected` viene de la
 * vista previa y algo cambio desde entonces, la base responde `stale` y la pantalla vuelve a mostrar el plan.
 */
export async function completeTaskCore(
  ctx: TaskCtx,
  taskId: string,
  applyShifts: boolean,
  expected?: Array<{ task_id: string; updated_at: string }>,
): Promise<TaskActionResult<CompleteOutput>> {
  if (!parseWith(taskIdSchema, taskId).ok) return fail("validation", "Los datos no son válidos.");
  const built = await buildPlan(ctx, taskId);
  if (!built) return fail("forbidden", FORBIDDEN_MESSAGE);
  const { plan, root, rows } = built;

  const shifts = applyShifts ? plan.shifts : [];
  const p_shifts = shifts.map((s) => ({
    task_id: s.taskId,
    due_date: s.toDue,
    ...(s.toStart ? { start_date: s.toStart } : {}),
  }));
  const p_expected = expected ?? plan.expected.filter((e) => e.task_id === taskId || shifts.some((s) => s.taskId === e.task_id));

  const { data, error } = await ctx.supabase.rpc("complete_task_with_shifts", {
    p_task_id: taskId,
    p_shifts: p_shifts as unknown as Json,
    p_expected: p_expected as unknown as Json,
  });
  if (error) {
    console.error("[tareas] complete_task_with_shifts:", error.message);
    return fail("server", "No pude completar la tarea. Probá de nuevo.");
  }
  const result = data as { ok: boolean; error?: string; shifted?: CompleteOutput["shifted"] } | null;
  if (!result?.ok) {
    const mapped = RPC_ERRORS[result?.error ?? ""];
    return fail(mapped?.code ?? "server", mapped?.message ?? "No pude completar la tarea. Probá de nuevo.");
  }

  // Quien quedo sin bloqueantes pendientes (con lo que ya se sabe: la tarea recien completada cuenta como hecha).
  const movedIds = new Set(shifts.map((s) => s.taskId));
  const isDone = (id: string) => id === taskId || rows.find((r) => r.id === id)?.status === "completed";
  const unblocked = rows
    .filter(
      (r) =>
        r.status !== "completed" &&
        r.id !== taskId &&
        (r.blocked_by ?? []).some((b) => b.task_id === taskId) &&
        (r.blocked_by ?? []).every((b) => isDone(b.task_id)),
    )
    .map((r) => ({ task_id: r.id, title: r.title, owner_id: r.owner_id }));

  const movedRows = rows.filter((r) => movedIds.has(r.id));
  const shifted = result.shifted ?? [];

  await notify(ctx, () =>
    planCompleted(
      {
        task: root,
        moved: shifted.flatMap((s) => {
          const row = movedRows.find((r) => r.id === s.task_id);
          return row ? [{ row, toDue: s.to_due }] : [];
        }),
        unblocked,
      },
      actorOf(ctx),
      todayInputValue(new Date(), ctx.timeZone),
    ),
  );

  return success({ task: root, shifted, unblocked, movedRows });
}

// ── Dependencias y borrado ──────────────────────────────────────────────────

const BLOCKER_CODES: Record<string, { code: "cycle" | "date_before_blocker" | "validation" | "forbidden"; message: string }> = {
  cycle: { code: "cycle", message: BLOCKER_ERROR_MESSAGES.cycle },
  date_before_blocker: { code: "date_before_blocker", message: BLOCKER_ERROR_MESSAGES.date_before_blocker },
  too_many: { code: "validation", message: BLOCKER_ERROR_MESSAGES.too_many },
  duplicate: { code: "validation", message: BLOCKER_ERROR_MESSAGES.duplicate },
  self: { code: "validation", message: BLOCKER_ERROR_MESSAGES.self },
  missing_task: { code: "validation", message: BLOCKER_ERROR_MESSAGES.missing_task },
  invalid: { code: "validation", message: "Los datos no son válidos." },
  forbidden: { code: "forbidden", message: FORBIDDEN_MESSAGE },
  not_found: { code: "forbidden", message: FORBIDDEN_MESSAGE },
};

export async function setTaskBlockersCore(ctx: TaskCtx, taskId: string, blockerIds: string[]): Promise<TaskActionResult<TaskBlocker[]>> {
  if (!parseWith(taskIdSchema, taskId).ok || !Array.isArray(blockerIds) || !blockerIds.every((id) => parseWith(taskIdSchema, id).ok)) {
    return fail("validation", "Los datos no son válidos.");
  }
  const { data, error } = await ctx.supabase.rpc("set_task_blockers", { p_task_id: taskId, p_blockers: blockerIds as unknown as Json });
  if (error) {
    console.error("[tareas] set_task_blockers:", error.message);
    return fail("server", "No pude guardar las dependencias. Probá de nuevo.");
  }
  const result = data as { ok: boolean; error?: BlockerErrorCode | string; blocked_by?: TaskBlocker[] } | null;
  if (!result?.ok) {
    const mapped = BLOCKER_CODES[result?.error ?? ""];
    return fail(mapped?.code ?? "server", mapped?.message ?? "No pude guardar las dependencias. Probá de nuevo.");
  }
  return success(result.blocked_by ?? []);
}

export async function deleteTaskCore(ctx: TaskCtx, taskId: string): Promise<TaskActionResult<{ unlinkedFrom: number }>> {
  if (!parseWith(taskIdSchema, taskId).ok) return fail("validation", "Los datos no son válidos.");
  const { data, error } = await ctx.supabase.rpc("delete_task", { p_task_id: taskId });
  if (error) {
    console.error("[tareas] delete_task:", error.message);
    return fail("server", "No pude borrar la tarea. Probá de nuevo.");
  }
  const result = data as { ok: boolean; error?: string; unlinked_from?: number } | null;
  if (!result?.ok) return fail("forbidden", "No tenés permiso para borrar esa tarea o ya no existe.");
  return success({ unlinkedFrom: result.unlinked_from ?? 0 });
}
