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
 * Gasto invisible (seguridad, lote 3): una corrida de un modelo SIN precio
 * cargado queda con `cost_usd` null y `sum_ai_spend` no la cuenta, asi que con
 * un tope que corta podia gastar sin limite. La opcion mas simple: quien sabe
 * que modelo va a usar lo pasa en `opts.model`, y si hay un tope del negocio
 * que CORTA y ese modelo no tiene precio (para audio, precio por hora), no se
 * llama. Sin topes cargados, nada cambia (no se agregan topes por defecto).
 * Solo mira los topes del negocio: los del agente tienen valores por defecto y
 * un modelo sin precio los dejaria apagados sin que nadie los haya pedido.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { evaluateSpend, isTemporaryBlock, workspaceSpendCandidates } from "@/lib/ai/spend";
import { approachingThresholds, notifySpendApproaching } from "@/lib/ai/spend-alerts";
import { resolvePricing } from "@/lib/ai/pricing";

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
  opts: { model?: BudgetModel | null } = {},
): Promise<BudgetDecision> {
  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("ai_daily_cost_limit_usd, ai_monthly_cost_limit_usd, ai_daily_limit_action, ai_monthly_limit_action, ai_spend_alert_pct, timezone")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[ia] no pude leer los topes del workspace:", error.message);
    return { allowed: false, message: READ_ERROR_MESSAGE };
  }

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
