"use server";

import { generateText } from "ai";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { openAiRun } from "@/lib/ai/run";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { buildAnalysisContext, buildAnalysisSystemPrompt, hasSomethingToAnalyze } from "@/lib/meta/ai-analysis";
import { loadTaskInstructions } from "@/lib/ai-tasks/store";
import { resolveTaskModel } from "@/lib/ai-tasks/model";
import { createServiceClient } from "@/lib/supabase/server";
import { loadAdsInsights } from "@/lib/dashboards/ads-load";
import { isPeriodPreset, PERIOD_LABELS, resolvePeriod, type PeriodPreset } from "@/lib/dashboards/period";
import { parseMetaConfig, resolveSyncedAccount, syncedAccounts } from "@/lib/meta/accounts";
import { resolveViewerTimezone } from "@/lib/user-timezone";

/**
 * "Analizar con IA" el rendimiento de los anuncios (F61).
 *
 * El modelo ve SOLO los numeros de la cuenta, en texto, y se le pide que no
 * invente. Es la diferencia entre un analisis y una opinion generica sobre
 * publicidad.
 *
 * Es una TAREA de Agentes IA (`ads_analysis`): el system prompt sale de sus
 * instrucciones versionadas (o del texto del sistema, si nadie las edito) y el
 * modelo es el que se eligio en la pantalla de la tarea (o el del negocio).
 *
 * El costo se registra y los topes del workspace se respetan ANTES de
 * llamar, con la misma funcion que usa la generacion de copy: un tope que
 * significa dos cosas distintas segun quien pregunte no es un tope.
 */

export type AdsAnalysisResult =
  | {
      ok: true;
      text: string;
      costUsd: number | null;
      /** "anthropic/claude-haiku-4-5": con que modelo salio este analisis. */
      model: string;
    }
  | { ok: false; error: string };

const TASK_SCREEN_HINT = "Se cambia en Agentes IA → Análisis de anuncios.";

export async function analyzeAdsWithAi(input: {
  period?: string;
  adAccountId?: string;
  question?: string;
}): Promise<AdsAnalysisResult> {
  const { workspace, supabase } = await requireWorkspaceAdmin();

  const period: PeriodPreset =
    input.period && isPeriodPreset(input.period) ? input.period : "30d";

  const { data: configRow } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", workspace.id)
    .eq("type", "meta")
    .eq("provider", "meta")
    .maybeSingle();

  const config = parseMetaConfig(configRow?.config);
  const resolved = resolveSyncedAccount(config.ad_accounts, input.adAccountId);
  if (!resolved.ok) {
    return { ok: false, error: "No hay ninguna cuenta publicitaria sincronizando" };
  }

  const account = syncedAccounts(config.ad_accounts).find(
    (a) => a.ad_account_id === resolved.adAccountId,
  );

  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const range = resolvePeriod(period, new Date(), timeZone);
  const rows = await loadAdsInsights(supabase, {
    workspaceId: workspace.id,
    adAccountId: resolved.adAccountId,
    period: range,
    timeZone,
  });

  // Sin gasto no hay nada que analizar: gastar una llamada al modelo para
  // que diga "no hay datos" es gastar por nada.
  if (!hasSomethingToAnalyze(rows)) {
    return { ok: false, error: "No hubo gasto en anuncios en este periodo: no hay nada que analizar." };
  }

  const budget = await withinWorkspaceBudget(supabase, workspace.id);
  if (!budget.allowed) {
    return { ok: false, error: budget.message ?? "Tope de gasto de IA alcanzado" };
  }

  // Con service role: la key del proveedor y las instrucciones se leen igual
  // que en el resto de las tareas (no dependen de quien aprieta el boton).
  const service = await createServiceClient();
  const [model, instructions] = await Promise.all([
    resolveTaskModel(service, workspace.id, "ads_analysis"),
    loadTaskInstructions(service, workspace.id, "ads_analysis"),
  ]);
  if (!model.ok || !model.model) {
    const base = model.message ?? "No hay un proveedor de IA conectado. Conectalo en Ajustes → Integraciones.";
    // Con un modelo elegido a mano, el problema es de esa eleccion: se dice donde cambiarla.
    return { ok: false, error: model.chosen ? `${base} ${TASK_SCREEN_HINT}` : base };
  }

  const context = buildAnalysisContext({
    periodLabel: PERIOD_LABELS[period],
    currency: account?.currency ?? null,
    rows,
  });

  const run = await openAiRun(supabase, {
    workspaceId: workspace.id,
    source: "ads_analysis",
    trigger: "manual",
    // Con que version de las instrucciones salio cada analisis (null = texto del sistema).
    promptVersion: instructions.version,
  });
  run.setModel(model.provider!, model.modelId!);

  const startedAt = Date.now();

  try {
    const result = await generateText({
      model: model.model,
      system: buildAnalysisSystemPrompt(instructions.text),
      prompt: input.question ? `${context}\n\nPREGUNTA: ${input.question}` : context,
    });

    run.setFinalUsage(result.usage);
    await run.step({
      kind: "model_call",
      name: `${model.provider}/${model.modelId}`,
      // Metadatos, no el texto: el analisis se le devuelve a quien lo pidio.
      output: { period, rows: rows.length },
      durationMs: Date.now() - startedAt,
    });

    const closed = await run.close({ status: "responded" });
    return { ok: true, text: result.text, costUsd: closed.costUsd, model: `${model.provider}/${model.modelId}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error desconocido";
    console.error("[ads] fallo el analisis con IA:", detail);

    await run.close({ status: "error", statusDetail: "generation_failed", error: detail });

    return {
      ok: false,
      error: "No pude analizar los anuncios. Revisa que la API key del proveedor siga valida y que el modelo elegido exista.",
    };
  }
}
