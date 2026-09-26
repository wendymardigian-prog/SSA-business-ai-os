/**
 * La llamada al modelo que escribe el guion y los captions (F29).
 *
 * Es la unica parte de F29 que habla con un proveedor. Todo lo que decide
 * algo —como se arma el pedido, si la salida sirve, como queda la pieza— vive
 * en `lib/content/ai-copy.ts`, que es puro y esta testeado.
 *
 * Se apoya en la infraestructura de IA que ya existe:
 *   - el proveedor y el modelo son los del WORKSPACE (BYOK),
 *   - el costo se registra con `openAiRun` (fuente `content_copy`),
 *   - los topes de gasto del workspace se respetan ANTES de llamar.
 *
 * Esa ultima parte importa: sin el chequeo previo, un workspace que llego a
 * su tope igual gastaria, y el tope dejaria de significar algo.
 */

import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { openAiRun } from "@/lib/ai/run";
import { evaluateSpend } from "@/lib/ai/spend";
import { BUSINESS_TIMEZONE } from "@/lib/dates";
import {
  buildPrompt,
  copyOutputSchema,
  SYSTEM_PROMPT,
  validateCopyOutput,
  type CopyRequest,
  type CopyValidation,
} from "@/lib/content/ai-copy";

type Db = SupabaseClient<Database>;

export type GenerateCopyResult =
  | (Extract<CopyValidation, { ok: true }> & { runId: string | null; costUsd: number | null })
  | { ok: false; error: string; reason: "no_provider" | "spend_limit" | "invalid_output" | "failed" };

/**
 * El gasto del workspace en el mes, contra su tope.
 *
 * Se usa `evaluateSpend`, la misma funcion pura que el agente: que la regla
 * sea una sola es lo que evita que "llegue al tope" signifique dos cosas
 * distintas segun quien pregunte.
 */
async function withinBudget(
  supabase: Db,
  workspaceId: string,
): Promise<{ allowed: boolean; message?: string }> {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("ai_daily_cost_limit_usd, ai_monthly_cost_limit_usd")
    .eq("id", workspaceId)
    .maybeSingle();

  const daily = workspace?.ai_daily_cost_limit_usd ?? null;
  const monthly = workspace?.ai_monthly_cost_limit_usd ?? null;
  if (daily === null && monthly === null) return { allowed: true };

  const now = new Date();
  const dayStart = new Date(
    new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(now) + "T00:00:00Z",
  );
  const monthStart = new Date(`${dayStart.toISOString().slice(0, 7)}-01T00:00:00Z`);

  const [spentDay, spentMonth] = await Promise.all([
    sumSpend(supabase, workspaceId, dayStart),
    sumSpend(supabase, workspaceId, monthStart),
  ]);

  // Si no se puede leer el gasto, no se llama: del lado seguro.
  if (spentDay === null || spentMonth === null) {
    return { allowed: false, message: "No pude verificar el gasto de IA del workspace." };
  }

  const check = evaluateSpend([
    { scope: "workspace_daily", limitUsd: daily, action: "disable", spentUsd: spentDay },
    { scope: "workspace_monthly", limitUsd: monthly, action: "disable", spentUsd: spentMonth },
  ]);

  if (check.allowed) return { allowed: true };

  return {
    allowed: false,
    message: `El workspace llego a su tope de gasto de IA (USD ${check.blocking.limitUsd}). Subilo en Agentes → Costos o espera al proximo periodo.`,
  };
}

async function sumSpend(supabase: Db, workspaceId: string, since: Date): Promise<number | null> {
  const { data, error } = await supabase.rpc("sum_ai_spend", {
    p_workspace_id: workspaceId,
    p_agent_id: null,
    p_since: since.toISOString(),
  });
  if (error) {
    console.error("[content] no pude leer el gasto de IA:", error.message);
    return null;
  }
  return Number(data ?? 0);
}

/**
 * Genera el guion y los captions.
 *
 * `generateObject` con el esquema de Zod: se le pide al proveedor que
 * devuelva esa forma, y ademas se valida al recibirla. Las dos cosas, porque
 * "pedir" no es "garantizar".
 */
export async function generateCopy(
  supabase: Db,
  params: {
    workspaceId: string;
    userId: string;
    postId: string;
    request: CopyRequest;
  },
): Promise<GenerateCopyResult> {
  const budget = await withinBudget(supabase, params.workspaceId);
  if (!budget.allowed) {
    return { ok: false, reason: "spend_limit", error: budget.message ?? "Tope de gasto alcanzado" };
  }

  const resolved = await getWorkspaceModel(params.workspaceId, { supabase });
  if (!resolved.ok || !resolved.model) {
    return {
      ok: false,
      reason: "no_provider",
      error:
        resolved.message ??
        "No hay un proveedor de IA conectado. Conectalo en Integraciones para generar el guion.",
    };
  }

  const run = await openAiRun(supabase, {
    workspaceId: params.workspaceId,
    source: "content_copy",
    trigger: "manual",
  });
  run.setModel(resolved.provider!, resolved.modelId!);

  const startedAt = Date.now();
  try {
    const result = await generateObject({
      model: resolved.model,
      schema: copyOutputSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(params.request),
    });

    run.setFinalUsage(result.usage);
    await run.step({
      kind: "model_call",
      name: `${resolved.provider}/${resolved.modelId}`,
      // Metadatos, no el texto: el contenido ya queda en la pieza.
      output: { platforms: params.request.platforms.length },
      durationMs: Date.now() - startedAt,
    });

    const checked = validateCopyOutput(result.object, params.request.platforms);
    if (!checked.ok) {
      await run.close({ status: "error", statusDetail: "invalid_output", error: checked.error });
      return { ok: false, reason: "invalid_output", error: checked.error };
    }

    const closed = await run.close({ status: "responded" });
    return { ...checked, runId: run.runId, costUsd: closed.costUsd };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error desconocido";
    console.error(`[content] fallo la generacion de copy:`, detail);

    await run.step({
      kind: "model_call",
      name: `${resolved.provider}/${resolved.modelId}`,
      durationMs: Date.now() - startedAt,
      error: "generation_failed",
    });
    await run.close({ status: "error", statusDetail: "generation_failed", error: detail });

    return {
      ok: false,
      reason: "failed",
      error:
        "No pude generar el guion. Revisa que la API key del proveedor siga siendo valida y tenga saldo.",
    };
  }
}
