/**
 * El tope de gasto de IA del WORKSPACE (F29, F61).
 *
 * Vive aca y no dentro de quien llama por una razon concreta: la Etapa 2
 * suma dos usos de IA que no son el agente (escribir copy y analizar
 * anuncios), y si cada uno tuviera su propio chequeo, "llegue al tope"
 * significaria dos cosas distintas segun quien pregunte.
 *
 * Se apoya en `evaluateSpend`, la misma funcion pura que usa el agente.
 *
 * La decision que importa: **si no se puede leer el gasto, no se llama al
 * modelo**. Un tope que se salta cuando falla la consulta no es un tope.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { evaluateSpend } from "@/lib/ai/spend";
import { BUSINESS_TIMEZONE } from "@/lib/dates";

type Db = SupabaseClient<Database>;

export interface BudgetDecision {
  allowed: boolean;
  message?: string;
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
): Promise<BudgetDecision> {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("ai_daily_cost_limit_usd, ai_monthly_cost_limit_usd")
    .eq("id", workspaceId)
    .maybeSingle();

  const daily = workspace?.ai_daily_cost_limit_usd ?? null;
  const monthly = workspace?.ai_monthly_cost_limit_usd ?? null;
  // Sin topes configurados no hay nada que chequear.
  if (daily === null && monthly === null) return { allowed: true };

  const dayStart = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: BUSINESS_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now) + "T00:00:00Z",
  );
  const monthStart = new Date(`${dayStart.toISOString().slice(0, 7)}-01T00:00:00Z`);

  const [spentDay, spentMonth] = await Promise.all([
    sumSpend(supabase, workspaceId, dayStart),
    sumSpend(supabase, workspaceId, monthStart),
  ]);

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
