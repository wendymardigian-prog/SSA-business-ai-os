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
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { evaluateSpend, isTemporaryBlock, workspaceSpendCandidates } from "@/lib/ai/spend";

type Db = SupabaseClient<Database>;

export interface BudgetDecision {
  allowed: boolean;
  message?: string;
}

const READ_ERROR_MESSAGE = "No pude verificar el gasto de IA del workspace.";

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
): Promise<BudgetDecision> {
  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("ai_daily_cost_limit_usd, ai_monthly_cost_limit_usd, timezone")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[ia] no pude leer los topes del workspace:", error.message);
    return { allowed: false, message: READ_ERROR_MESSAGE };
  }

  const candidates = workspaceSpendCandidates({
    dailyUsd: workspace?.ai_daily_cost_limit_usd,
    monthlyUsd: workspace?.ai_monthly_cost_limit_usd,
    now,
    timeZone: workspace?.timezone || "UTC",
  });
  // Sin topes configurados no hay nada que chequear.
  if (candidates.length === 0) return { allowed: true };

  const spent = await Promise.all(candidates.map((c) => sumSpend(supabase, workspaceId, c.since)));
  if (spent.some((s) => s === null)) return { allowed: false, message: READ_ERROR_MESSAGE };

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
