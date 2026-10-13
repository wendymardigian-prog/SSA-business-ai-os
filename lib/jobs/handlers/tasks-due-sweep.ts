/**
 * El job `tasks_due_sweep` (Extra A, F18): avisa en la campana lo que vence hoy y lo que ya venció.
 *
 * Lo encola `private.enqueue_tasks_due_sweep()` (00198, pg_cron cada hora) UNA vez por workspace y por día local,
 * desde las 08:00 de su zona y solo si hay candidatas. Acá, para ese workspace y ESE día (`local_date` del
 * payload, no «hoy»):
 *
 *  - `task_due_today`: la tarea vence ese día → al responsable y a los seguidores.
 *  - `task_overdue`: la tarea venció antes → al responsable, la PRIMERA vez (los días siguientes no se repite).
 *  - Una sola vez por tarea, persona y fecha de vencimiento (se compara con `metadata.due_date` de los avisos que ya
 *    hay): correr el job dos veces, o que el cron lo vuelva a encolar, no duplica nada.
 *  - Nunca avisa de una tarea completada o borrada ni de una sin responsable ni seguidores.
 *
 * Un error de la base lanza (la cola reintenta); un aviso que no se puede escribir no frena a los demás.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInputValue, zonedClock } from "@/lib/dates";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { createNotification } from "@/lib/notifications/create";
import { emitTaskEvent } from "@/lib/tasks/automation/emit";
import { isDateOnly } from "@/lib/tasks/dates";
import { formatDayShort } from "@/lib/tasks/format";
import type { TaskPriority, TaskSource, TaskStatus } from "@/lib/tasks/types";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export const TASKS_DUE_SWEEP_JOB = "tasks_due_sweep";

/** Desde que hora local (de 0 a 24) se avisa. Es el mismo 8 de `private.enqueue_tasks_due_sweep()`. */
export const SWEEP_START_HOUR = 8;

const PAGE = 500;
const MAX_PAGES = 40;
const ID_CHUNK = 200;

/** ¿Ya son las 08:00 locales? Espejo de la regla de la función SQL (07:59 no, 08:00 sí). */
export function isSweepWindow(now: Date, timeZone: string): boolean {
  return zonedClock(now, timeZone).minutes >= SWEEP_START_HOUR * 60;
}

interface Candidate {
  id: string;
  workspace_id: string;
  title: string;
  due_date: string;
  owner_id: string | null;
  follower_ids: string[];
  // Para el evento `task_overdue` (F25).
  contact_id: string | null;
  created_by: string | null;
  project: string | null;
  project_key: string | null;
  status: TaskStatus;
  source: TaskSource;
  priority: TaskPriority;
  completed_at: string | null;
}

export interface DueSweepResult {
  dueToday: number;
  overdue: number;
  /** Eventos `task_overdue` que se encolaron para las automatizaciones. */
  events: number;
}

async function loadCandidates(db: Db, workspaceId: string, localDate: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  let lastId: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = db
      .from("tasks")
      .select("id, workspace_id, title, due_date, owner_id, follower_ids, contact_id, created_by, project, project_key, status, source, priority, completed_at")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .neq("status", "completed")
      .lte("due_date", localDate)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw new Error(`no pude leer las tareas: ${error.message}`);
    const rows = (data ?? []) as unknown as Candidate[];
    for (const r of rows) {
      if (r.due_date && (r.owner_id || (r.follower_ids ?? []).length > 0)) out.push(r);
    }
    if (rows.length < PAGE) break;
    lastId = rows[rows.length - 1].id;
  }
  return out;
}

/** Los avisos que ya existen: `tipo:tarea:persona:vencimiento`. */
async function loadExisting(db: Db, workspaceId: string, taskIds: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < taskIds.length; i += ID_CHUNK) {
    const chunk = taskIds.slice(i, i + ID_CHUNK);
    const { data, error } = await db
      .from("notifications")
      .select("type, entity_id, recipient_id, metadata")
      .eq("workspace_id", workspaceId)
      .in("type", ["task_due_today", "task_overdue"])
      .in("entity_id", chunk);
    if (error) throw new Error(`no pude leer los avisos: ${error.message}`);
    for (const n of data ?? []) {
      const due = (n.metadata as { due_date?: string } | null)?.due_date;
      seen.add(`${n.type}:${n.entity_id}:${n.recipient_id}:${due}`);
    }
  }
  return seen;
}

/** Los eventos `task_overdue` que ya se encolaron: `tarea:vencimiento`. */
async function loadExistingOverdueEvents(db: Db, workspaceId: string, taskIds: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < taskIds.length; i += ID_CHUNK) {
    const chunk = taskIds.slice(i, i + ID_CHUNK);
    const { data, error } = await db
      .from("automation_events")
      .select("payload")
      .eq("workspace_id", workspaceId)
      .eq("event_type", "task_overdue")
      .in("payload->>task_id", chunk);
    if (error) throw new Error(`no pude leer los eventos: ${error.message}`);
    for (const e of data ?? []) {
      const p = (e.payload ?? {}) as { task_id?: string; due_date?: string };
      seen.add(`${p.task_id}:${p.due_date}`);
    }
  }
  return seen;
}

export async function runTasksDueSweep(db: Db, workspaceId: string, localDate: string): Promise<DueSweepResult> {
  const candidates = await loadCandidates(db, workspaceId, localDate);
  if (candidates.length === 0) return { dueToday: 0, overdue: 0, events: 0 };
  const existing = await loadExisting(db, workspaceId, candidates.map((c) => c.id));

  const result: DueSweepResult = { dueToday: 0, overdue: 0, events: 0 };

  // El disparador `task_overdue` (F25): una vez por tarea y vencimiento, tambien para las que ya tenian el aviso.
  const overdue = candidates.filter((c) => c.due_date < localDate);
  if (overdue.length > 0) {
    const emitted = await loadExistingOverdueEvents(db, workspaceId, overdue.map((c) => c.id));
    for (const task of overdue) {
      if (emitted.has(`${task.id}:${task.due_date}`)) continue;
      if (await emitTaskEvent(db, "task_overdue", task)) result.events += 1;
    }
  }

  for (const task of candidates) {
    const today = task.due_date === localDate;
    const type = today ? "task_due_today" : "task_overdue";
    // Vence hoy: responsable y seguidores. Vencida: solo el responsable.
    const recipients = today ? [task.owner_id, ...task.follower_ids] : [task.owner_id];
    for (const recipientId of [...new Set(recipients)]) {
      if (!recipientId) continue;
      if (existing.has(`${type}:${task.id}:${recipientId}:${task.due_date}`)) continue;
      const ok = await createNotification({
        supabase: db,
        workspaceId,
        type,
        title: today ? `«${task.title}» vence hoy` : `«${task.title}» está vencida`,
        body: today ? undefined : `Venció el ${formatDayShort(task.due_date, localDate)} y sigue sin completarse.`,
        entityType: "task",
        entityId: task.id,
        recipientId,
        metadata: { task_id: task.id, due_date: task.due_date },
      });
      if (ok) result[today ? "dueToday" : "overdue"] += 1;
    }
  }
  return result;
}

export async function handleTasksDueSweep(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as unknown as { workspace_id?: string; local_date?: string } | null;
  if (!payload?.workspace_id || !isDateOnly(payload.local_date)) return;

  // Un job del dia de hoy no avisa antes de las 08:00 locales (por si lo encola alguien a mano).
  const { data: workspace } = await ctx.supabase.from("workspaces").select("timezone").eq("id", payload.workspace_id).maybeSingle();
  const tz = workspace?.timezone || "UTC";
  const now = new Date();
  if (payload.local_date === todayInputValue(now, tz) && !isSweepWindow(now, tz)) return;

  await runTasksDueSweep(ctx.supabase, payload.workspace_id, payload.local_date);
}

export function registerTasksDueSweepHandler(): void {
  registerJobHandler(TASKS_DUE_SWEEP_JOB, handleTasksDueSweep);
}
