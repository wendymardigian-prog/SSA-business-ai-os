/**
 * El job `finance_daily` (Extra I, Gastos): el trabajo diario de Finanzas de UN workspace y UN día local.
 *
 * Lo encola `private.enqueue_finance_daily()` (00228; la tarea de pg_cron es la 00233) una vez por día local, desde
 * las 03:00 de la zona del workspace, y «Calcular ahora» lo encola a mano. Los pasos, en este orden y cada uno en su
 * propio try con su resultado anotado (si uno falla, los demás corren igual):
 *
 *   1. generar los gastos de las plantillas recurrentes      (G2)
 *   2. recalcular los automáticos y cerrar los de meses viejos (G2)
 *   3. vencer los programados cuya fecha ya pasó
 *   4. avisar (una notificación por tipo, a Owner/Admin)
 *
 * TODO es idempotente (los índices únicos de la base y los estados), así que repetir el trabajo es seguro. Si algún
 * paso falló, el handler LANZA AL FINAL con la lista de pasos fallidos: el trabajo queda fallido y se ve, y la cola
 * lo reintenta. Lo que ya salió bien no se deshace. Los logs llevan cantidades e ids, nunca montos por proveedor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditAsSystem } from "@/lib/audit";
import { isDateOnly } from "@/lib/finance/dates";
import { summarizeOverdue } from "@/lib/finance/summary-text";
import { toCents } from "@/lib/sales/money";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { createNotification } from "@/lib/notifications/create";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export const FINANCE_DAILY_JOB = "finance_daily";
export const FINANCE_AUDIT_LABEL = "Finanzas: trabajo diario";

export interface DailyStepResult {
  step: string;
  ok: boolean;
  /** Cantidades, no datos. */
  detail?: Record<string, number | string>;
  error?: string;
}

export interface FinanceDailyContext {
  db: Db;
  workspaceId: string;
  localDate: string;
  timeZone: string;
  /** Lo que los pasos anteriores dejaron para los avisos. */
  review: { pending: number };
}

type Step = { name: string; run: (ctx: FinanceDailyContext) => Promise<Record<string, number | string> | void> };

/** Los pasos que suman los bloques siguientes se enchufan acá (en este orden). */
const EXTRA_STEPS_BEFORE_OVERDUE: Step[] = [];
export function registerFinanceDailyStep(step: Step, position: "before_overdue" = "before_overdue"): void {
  if (position === "before_overdue" && !EXTRA_STEPS_BEFORE_OVERDUE.some((s) => s.name === step.name)) EXTRA_STEPS_BEFORE_OVERDUE.push(step);
}

/** Paso 3: vencer. Solo `programado` con fecha anterior a hoy; devuelve cuántos y por cuánto (en céntimos). */
async function overdueStep(ctx: FinanceDailyContext): Promise<Record<string, number | string>> {
  const { data: ids, error } = await ctx.db.rpc("mark_expenses_overdue", { p_workspace_id: ctx.workspaceId, p_today: ctx.localDate });
  if (error) throw new Error(`no pude vencer los gastos: ${error.message}`);
  const list = ((ids ?? []) as unknown as string[]).filter(Boolean);
  if (list.length === 0) return { overdue: 0 };

  const { data: rows } = await ctx.db.from("expenses").select("id, amount").eq("workspace_id", ctx.workspaceId).in("id", list);
  const cents = ((rows ?? []) as Array<{ id: string; amount: unknown }>).map((r) => ({ id: r.id, cents: toCents(r.amount) }));

  for (const id of list) {
    await auditAsSystem({
      supabase: ctx.db, workspaceId: ctx.workspaceId, entityType: "expense", entityId: id, action: "expense.overdue",
      changes: { status: { old: "programado", new: "vencido" } }, label: FINANCE_AUDIT_LABEL,
    });
  }
  const summary = summarizeOverdue(cents);
  if (summary) {
    await createNotification({
      supabase: ctx.db, workspaceId: ctx.workspaceId, type: "expense_overdue", title: summary.title, body: summary.body,
      entityType: "expense", metadata: { pill: "vencidos", count: list.length, local_date: ctx.localDate },
    });
  }
  return { overdue: list.length };
}

/** Paso 4: «por revisar» (lo dejó el paso de recurrentes). */
async function reviewStep(ctx: FinanceDailyContext): Promise<Record<string, number | string>> {
  if (ctx.review.pending <= 0) return { review_pending: 0 };
  const count = ctx.review.pending;
  await createNotification({
    supabase: ctx.db, workspaceId: ctx.workspaceId, type: "expense_review_pending",
    title: `${count} ${count === 1 ? "gasto espera" : "gastos esperan"} que cargues el monto`,
    body: "Son gastos que se repiten y todavía no tienen monto. Cargalos para que se programen.",
    entityType: "expense", metadata: { pill: "por_revisar", count, local_date: ctx.localDate },
  });
  return { review_pending: count };
}

export async function runFinanceDaily(db: Db, workspaceId: string, localDate: string, timeZone: string): Promise<{ results: DailyStepResult[]; failed: string[] }> {
  const ctx: FinanceDailyContext = { db, workspaceId, localDate, timeZone, review: { pending: 0 } };
  const steps: Step[] = [...EXTRA_STEPS_BEFORE_OVERDUE, { name: "overdue", run: overdueStep }, { name: "review_notice", run: reviewStep }];

  const results: DailyStepResult[] = [];
  for (const step of steps) {
    try {
      const detail = await step.run(ctx);
      results.push({ step: step.name, ok: true, ...(detail ? { detail } : {}) });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[finance_daily] el paso ${step.name} falló (workspace ${workspaceId}):`, error);
      results.push({ step: step.name, ok: false, error });
    }
  }
  return { results, failed: results.filter((r) => !r.ok).map((r) => r.step) };
}

export async function handleFinanceDaily(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as unknown as { workspace_id?: string; local_date?: string } | null;
  if (!payload?.workspace_id || !isDateOnly(payload.local_date)) return;
  const { data: workspace } = await ctx.supabase.from("workspaces").select("timezone").eq("id", payload.workspace_id).maybeSingle();
  const tz = (workspace as { timezone?: string | null } | null)?.timezone || "UTC";

  const { failed } = await runFinanceDaily(ctx.supabase, payload.workspace_id, payload.local_date, tz);
  // Lanza al final con los pasos fallidos: el trabajo queda fallido y se ve; repetir es seguro.
  if (failed.length > 0) throw new Error(`finance_daily: fallaron los pasos ${failed.join(", ")}`);
}

export function registerFinanceDailyHandler(): void {
  registerJobHandler(FINANCE_DAILY_JOB, handleFinanceDaily);
}
