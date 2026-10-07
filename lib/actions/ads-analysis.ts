"use server";

import { generateText } from "ai";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { openAiRun } from "@/lib/ai/run";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { buildAnalysisContext, hasSomethingToAnalyze, SYSTEM_PROMPT } from "@/lib/meta/ai-analysis";
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
 * El costo se registra y los topes del workspace se respetan ANTES de
 * llamar, con la misma funcion que usa la generacion de copy: un tope que
 * significa dos cosas distintas segun quien pregunte no es un tope.
 */

export type AdsAnalysisResult =
  | { ok: true; text: string; costUsd: number | null }
  | { ok: false; error: string };

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

  const model = await getWorkspaceModel(workspace.id, { supabase });
  if (!model.ok || !model.model) {
    return {
      ok: false,
      error:
        model.message ??
        "No hay un proveedor de IA conectado. Conectalo en Ajustes → Integraciones.",
    };
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
  });
  run.setModel(model.provider!, model.modelId!);

  const startedAt = Date.now();

  try {
    const result = await generateText({
      model: model.model,
      system: SYSTEM_PROMPT(),
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
    return { ok: true, text: result.text, costUsd: closed.costUsd };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error desconocido";
    console.error("[ads] fallo el analisis con IA:", detail);

    await run.close({ status: "error", statusDetail: "generation_failed", error: detail });

    return {
      ok: false,
      error: "No pude analizar los anuncios. Revisa que la API key del proveedor siga valida.",
    };
  }
}
