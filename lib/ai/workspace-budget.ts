/**
 * El tope de gasto de IA del WORKSPACE (F29, F61).
 *
 * Vive aca y no dentro de quien llama por una razon concreta: la Etapa 2
 * suma dos usos de IA que no son el agente (escribir copy y analizar
 * anuncios), y si cada uno tuviera su propio chequeo, "llegue al tope"
 * significaria dos cosas distintas segun quien pregunte.
 *
 * Se apoya en `evaluateSpend` y `workspaceSpendCandidates`, las mismas
 * funciones que usa el agente: los topes, sus ventanas (medianoche LOCAL del
 * workspace, no UTC) y lo que significa alcanzarlos salen de un solo lugar.
 * Un tope diario corta hasta manana; uno mensual, hasta el proximo mes.
 *
 * La decision que importa: **si no se puede leer el gasto, o los topes, no
 * se llama al modelo**. Un tope que se salta cuando falla la consulta no es
 * un tope.
 *
 * Gasto invisible (seguridad, noviembre 2026): una corrida de un modelo SIN precio
 * cargado queda con `cost_usd` null y `sum_ai_spend` no la cuenta, asi que con
 * un tope que corta podia gastar sin limite. La opcion mas simple: quien sabe
 * que modelo va a usar lo pasa en `opts.model`, y si hay un tope del negocio
 * que CORTA y ese modelo no tiene precio (para audio, precio por hora), no se
 * llama. Sin topes cargados, nada cambia (no se agregan topes por defecto).
 * Solo mira los topes del negocio: los del agente tienen valores por defecto y
 * un modelo sin precio los dejaria apagados sin que nadie los haya pedido.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostLimitAction, Database } from "@/lib/types/database";
import { evaluateSpend, isTemporaryBlock, workspaceSpendCandidates } from "@/lib/ai/spend";
import { approachingThresholds, notifySpendApproaching } from "@/lib/ai/spend-alerts";
import { resolvePricing } from "@/lib/ai/pricing";
import { AI_TASKS, type AiTaskDef, type AiTaskId } from "@/lib/ai-tasks/catalog";
import { taskLimitsOf } from "@/lib/ai-tasks/limits";
import { startOfZonedMonth } from "@/lib/dates";
import { createNotification } from "@/lib/notifications/create";

type Db = SupabaseClient<Database>;

export interface BudgetDecision {
  allowed: boolean;
  message?: string;
}

/** El modelo que se va a usar, para no dejar pasar uno sin precio cuando hay un tope que corta. */
export interface BudgetModel {
  provider: string;
  model: string;
  /** `audio` se cobra por hora (transcripcion); el resto, por tokens. */
  kind?: "chat" | "audio";
}

/** El mensaje cuando el modelo no tiene precio y hay un tope que corta. */
export function unpricedModelMessage(model: BudgetModel): string {
  return `El modelo ${model.provider}/${model.model} no tiene precio cargado y el negocio tiene un tope de gasto de IA: no se usa hasta cargar su precio (sin precio, lo que gasta no se puede contar).`;
}

const READ_ERROR_MESSAGE = "No pude verificar el gasto de IA del workspace.";
const TASK_READ_ERROR_MESSAGE = "No pude verificar el gasto de IA de la tarea: no se llama al modelo.";

/** El mensaje cuando una tarea llego a su tope mensual. */
export function taskCapMessage(taskName: string, capUsd: number): string {
  return `La tarea «${taskName}» llegó a su tope mensual de gasto de IA (USD ${capUsd}). Subilo en Agentes IA › ${taskName} › Configuración o esperá al próximo mes.`;
}

/**
 * Decide el tope de UNA tarea con el gasto ya sumado. Pura: es lo que se testea.
 * Sin tope guardado, pasa. Con gasto que no se pudo leer (null), no pasa.
 * Con el tope en 0, la tarea queda frenada (es una forma explicita de apagarla por gasto).
 */
export function evaluateTaskCap(capUsd: number | null, spentUsd: number | null): "allowed" | "blocked" | "read_error" {
  if (capUsd === null) return "allowed";
  if (spentUsd === null) return "read_error";
  return spentUsd >= capUsd ? "blocked" : "allowed";
}

async function sumTaskSpend(supabase: Db, workspaceId: string, task: AiTaskDef, since: Date): Promise<number | null> {
  const { data, error } = await supabase.rpc("sum_ai_task_spend", {
    p_workspace_id: workspaceId,
    p_since: since.toISOString(),
    p_source: task.source,
    p_detail_like: task.detailLike ?? null,
  });
  if (error) {
    console.error("[ia] no pude leer el gasto de la tarea:", error.message);
    return null;
  }
  return Number(data ?? 0);
}

/**
 * El tope mensual de una tarea: avisa una vez al pasar el
 * porcentaje (el del negocio o el 80 %) y, al llegar, frena. Nunca deja pasar
 * si no puede leer el gasto o los topes.
 */
async function withinTaskCap(
  supabase: Db,
  workspaceId: string,
  taskId: AiTaskId,
  raw: { ai_task_limits?: unknown; ai_spend_alert_pct?: number | null; timezone?: string | null } | null,
  now: Date,
  model: BudgetModel | null | undefined,
): Promise<BudgetDecision> {
  const task = AI_TASKS[taskId];
  if (!task) return { allowed: true };
  const capUsd = taskLimitsOf(raw?.ai_task_limits, taskId).monthlyCapUsd;
  if (capUsd === null) return { allowed: true };

  // El tope de la tarea siempre corta: un modelo sin precio no se podria contar.
  if (model) {
    const price = await resolvePricing(supabase, { workspaceId, provider: model.provider, model: model.model, at: now });
    const priced = price !== null && (model.kind !== "audio" || price.audio_per_hour !== null);
    if (!priced) return { allowed: false, message: unpricedModelMessage(model) };
  }

  const since = startOfZonedMonth(now, raw?.timezone || "UTC");
  const spent = await sumTaskSpend(supabase, workspaceId, task, since);
  const decision = evaluateTaskCap(capUsd, spent);
  if (decision === "read_error") return { allowed: false, message: TASK_READ_ERROR_MESSAGE };

  await notifySpendApproaching(supabase, {
    workspaceId,
    approaching: approachingThresholds(
      [{ scope: "task_monthly", limitUsd: capUsd, spentUsd: spent as number, since, task: taskId, label: task.name }],
      raw?.ai_spend_alert_pct,
    ),
  });
  if (decision === "allowed") return { allowed: true };

  await notifyTaskCapReached(supabase, { workspaceId, taskId, taskName: task.name, capUsd, spentUsd: spent as number, since });
  return { allowed: false, message: taskCapMessage(task.name, capUsd) };
}

/** El aviso de "la tarea llego a su tope", una vez por tarea y mes. Nunca lanza. */
async function notifyTaskCapReached(
  supabase: Db,
  args: { workspaceId: string; taskId: string; taskName: string; capUsd: number; spentUsd: number; since: Date },
): Promise<void> {
  try {
    const key = { scope: "task_monthly", task: args.taskId, period_start: args.since.toISOString() };
    const { data, error } = await supabase
      .from("notifications")
      .select("id")
      .eq("workspace_id", args.workspaceId)
      .eq("type", "agent_spend_limit")
      .contains("metadata", key)
      .limit(1);
    if (!error && data && data.length > 0) return;
    await createNotification({
      supabase,
      workspaceId: args.workspaceId,
      type: "agent_spend_limit",
      title: `La tarea «${args.taskName}» llegó a su tope mensual de IA`,
      body: `Gastado: USD ${args.spentUsd.toFixed(2)} de USD ${args.capUsd.toFixed(2)}. La tarea no llama al modelo hasta el próximo mes o hasta que subas el tope.`,
      metadata: key,
    });
  } catch (err) {
    console.error("[ia] no pude avisar del tope de la tarea:", err instanceof Error ? err.message : String(err));
  }
}

async function sumSpend(supabase: Db, workspaceId: string, since: Date): Promise<number | null> {
  const { data, error } = await supabase.rpc("sum_ai_spend", {
    p_workspace_id: workspaceId,
    p_agent_id: null,
    p_since: since.toISOString(),
  });
  if (error) {
    console.error("[ia] no pude leer el gasto del workspace:", error.message);
    return null;
  }
  return Number(data ?? 0);
}

/** El gasto del dia y del mes contra los topes del workspace. */
export async function withinWorkspaceBudget(
  supabase: Db,
  workspaceId: string,
  now: Date = new Date(),
  opts: { model?: BudgetModel | null; task?: AiTaskId | null } = {},
): Promise<BudgetDecision> {
  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("ai_daily_cost_limit_usd, ai_monthly_cost_limit_usd, ai_daily_limit_action, ai_monthly_limit_action, ai_spend_alert_pct, timezone, ai_task_limits")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[ia] no pude leer los topes del workspace:", error.message);
    return { allowed: false, message: READ_ERROR_MESSAGE };
  }

  const ws = await withinWorkspaceCaps(supabase, workspaceId, workspace, now, opts.model);
  if (!ws.allowed || !opts.task) return ws;
  // : despues del tope del negocio, el de la tarea (frena al 100 %, avisa antes).
  return withinTaskCap(supabase, workspaceId, opts.task, workspace, now, opts.model);
}

async function withinWorkspaceCaps(
  supabase: Db,
  workspaceId: string,
  workspace: {
    ai_daily_cost_limit_usd: number | null;
    ai_monthly_cost_limit_usd: number | null;
    ai_daily_limit_action: CostLimitAction | null;
    ai_monthly_limit_action: CostLimitAction | null;
    ai_spend_alert_pct: number | null;
    timezone: string | null;
  } | null,
  now: Date,
  model: BudgetModel | null | undefined,
): Promise<BudgetDecision> {
  const opts = { model };

  const candidates = workspaceSpendCandidates({
    dailyUsd: workspace?.ai_daily_cost_limit_usd,
    monthlyUsd: workspace?.ai_monthly_cost_limit_usd,
    dailyAction: workspace?.ai_daily_limit_action,
    monthlyAction: workspace?.ai_monthly_limit_action,
    now,
    timeZone: workspace?.timezone || "UTC",
  });
  // Sin topes configurados no hay nada que chequear.
  if (candidates.length === 0) return { allowed: true };

  // Un tope que corta y un modelo sin precio: lo que gaste no se podria contar.
  if (opts.model && candidates.some((c) => c.action === "disable")) {
    const price = await resolvePricing(supabase, { workspaceId, provider: opts.model.provider, model: opts.model.model, at: now });
    const priced = price !== null && (opts.model.kind !== "audio" || price.audio_per_hour !== null);
    if (!priced) return { allowed: false, message: unpricedModelMessage(opts.model) };
  }

  const spent = await Promise.all(candidates.map((c) => sumSpend(supabase, workspaceId, c.since)));
  if (spent.some((s) => s === null)) return { allowed: false, message: READ_ERROR_MESSAGE };

  // El aviso previo (ai_spend_alert_pct), con la suma que ya se hizo. Nunca lanza.
  await notifySpendApproaching(supabase, {
    workspaceId,
    approaching: approachingThresholds(
      candidates.map((c, i) => ({ scope: c.scope, limitUsd: c.limitUsd, spentUsd: spent[i] as number, since: c.since })),
      workspace?.ai_spend_alert_pct,
    ),
  });

  const check = evaluateSpend(
    candidates.map((c, i) => ({ scope: c.scope, limitUsd: c.limitUsd, action: c.action, spentUsd: spent[i] as number })),
  );
  if (check.allowed) return { allowed: true };

  return {
    allowed: false,
    message: isTemporaryBlock(check.blocking.scope)
      ? `El workspace llego a su tope diario de gasto de IA (USD ${check.blocking.limitUsd}). Se reanuda solo manana, o subilo en Agentes → Costos.`
      : `El workspace llego a su tope mensual de gasto de IA (USD ${check.blocking.limitUsd}). Subilo en Agentes → Costos o espera al proximo mes.`,
  };
}
