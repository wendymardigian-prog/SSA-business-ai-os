/**
 * Lo que la pantalla de Tareas en segundo plano necesita leer.
 *
 * Corre en el servidor detras de `requireWorkspaceAdmin`. Usa el service role
 * para los COSTOS: `authenticated` no puede leer `cost_usd` ni los tokens de
 * `agent_runs` (GRANT por columna de la 00060), y `ai_cost_report` es solo de
 * service role. Ningun costo viaja al navegador sin pasar por ese guard.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { qualityReport, confidenceCalibration, type QualityReport } from "@/lib/patterns/quality";
import { accuracyByWeek, lastWeeks, mostCorrectedCategories, reviewQueue, type CorrectedCategory, type ReviewCandidate, type WeeklyAccuracy } from "@/lib/patterns/review-queue";
import { BACKGROUND_TASKS, type BackgroundTask } from "./settings";
import { TASK_RUN_SOURCES, TASK_RUN_SOURCE_LIST, type TaskRunInfo } from "./screen";

export interface RecentRun {
  at: string | null;
  source: string;
  status: string;
  detail: string | null;
  model: string | null;
  costUsd: number | null;
}

export interface ButtonText {
  textId: string;
  text: string;
  messageCount: number;
}

export interface ProviderInfo {
  label: string | null;
  /**
   * Si el proveedor tiene API por lote EN USO. Hoy es false para todos: el modo
   * economico agrupa pedidos, que ya ahorra, pero el lote real con descuento
   * esta pendiente (docs/PENDIENTE.md). Se dice en pantalla; prometer un
   * descuento que no se aplica seria mentir sobre la factura.
   */
  batchApiInUse: boolean;
}

export interface BackgroundScreenData {
  runs: Partial<Record<BackgroundTask, TaskRunInfo>>;
  provider: ProviderInfo;
  quality: QualityReport & { calibration: ReturnType<typeof confidenceCalibration> };
  accuracyWeeks: WeeklyAccuracy[];
  mostCorrected: CorrectedCategory[];
  reviewCandidates: ReviewCandidate[];
  classification: {
    lastRunAt: string | null;
    lastRunStatus: string | null;
    classifiedToday: number;
    unclassifiedPending: number;
    activePromptVersion: number | null;
    /** Textos que ya se revisaron o corrigieron: el set de control. */
    controlSetSize: number;
  };
  recentRuns: RecentRun[];
  buttonTexts: ButtonText[];
}

interface TextRow {
  text_id: string;
  direction: string;
  category_id: string | null;
  source: string | null;
  confidence: number | null;
  review_result: string | null;
  is_button: boolean;
  prompt_version: number | null;
  classified_at: string | null;
  reviewed_at: string | null;
  sample_text: string | null;
  message_count: number;
}

export async function loadBackgroundScreen(workspaceId: string, timezone: string, now = new Date()): Promise<BackgroundScreenData> {
  const service = await createServiceClient();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const [runsRes, costRes, providers, volumesRes, categoriesRes, statusRes, recentRes] = await Promise.all([
    // La ultima corrida de cada tarea: una fila por source.
    service
      .from("agent_runs")
      .select("source, status, status_detail, completed_at, created_at")
      .eq("workspace_id", workspaceId)
      .in("source", TASK_RUN_SOURCE_LIST)
      .order("created_at", { ascending: false })
      .limit(200),
    service.rpc("ai_cost_report", { p_workspace_id: workspaceId, p_from: monthStart, p_to: now.toISOString() }),
    listConnectedAiProviders(workspaceId, service),
    service.rpc("message_text_volumes", { p_workspace_id: workspaceId, p_direction: null, p_from: null, p_to: null }),
    service.from("message_categories").select("id, name, is_fallback, created_by, archived_at").eq("workspace_id", workspaceId),
    service.rpc("message_classification_status", { p_workspace_id: workspaceId, p_tz: timezone }),
    service
      .from("agent_runs")
      .select("source, status, status_detail, model, cost_usd, completed_at, created_at")
      .eq("workspace_id", workspaceId)
      .eq("source", "message_classification")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  // --- Gasto del mes por tarea, desde by_source de ai_cost_report.
  const bySource = new Map<string, number>();
  const report = costRes.data as { by_source?: Array<{ source?: string; cost_usd?: number }> } | null;
  for (const row of report?.by_source ?? []) {
    if (typeof row?.source === "string") bySource.set(row.source, Number(row.cost_usd ?? 0));
  }

  // --- Ultima corrida por tarea.
  const runRows = (runsRes.data ?? []) as Array<{ source: string; status: string; status_detail: string | null; completed_at: string | null; created_at: string }>;
  const runs: Partial<Record<BackgroundTask, TaskRunInfo>> = {};
  for (const task of BACKGROUND_TASKS) {
    const source = TASK_RUN_SOURCES[task];
    if (!source) continue;
    const last = runRows.find((r) => r.source === source);
    const spend = bySource.get(source);
    runs[task] = {
      at: last?.completed_at ?? last?.created_at ?? null,
      status: last?.status ?? null,
      detail: last?.status_detail ?? null,
      monthSpendUsd: spend === undefined ? null : spend,
    };
  }

  // --- Calidad, sobre los textos con su volumen de mensajes.
  const texts = (volumesRes.data ?? []) as TextRow[];
  const categories = (categoriesRes.data ?? []) as Array<{ id: string; name: string; is_fallback: boolean; created_by: string | null; archived_at: string | null }>;
  const fallbackIds = new Set(categories.filter((c) => c.is_fallback).map((c) => c.id));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const quality = qualityReport(
    texts.map((t) => ({
      category_id: t.category_id,
      source: t.source as "rule" | "model" | "human" | null,
      confidence: t.confidence === null ? null : Number(t.confidence),
      review_result: t.review_result as "ok" | "corrected" | null,
      messageCount: Number(t.message_count ?? 0),
    })),
    fallbackIds,
  );
  const reviewed = texts
    .filter((t) => t.review_result !== null)
    .map((t) => ({
      confidence: t.confidence === null ? null : Number(t.confidence),
      review_result: t.review_result as "ok" | "corrected" | null,
    }));

  const candidates: ReviewCandidate[] = texts.map((t) => ({
    textId: t.text_id,
    direction: t.direction === "outbound" ? "outbound" : "inbound",
    text: t.sample_text ?? "",
    categoryId: t.category_id,
    categoryName: t.category_id ? (categoryById.get(t.category_id)?.name ?? null) : null,
    confidence: t.confidence === null ? null : Number(t.confidence),
    source: t.source,
    reviewResult: t.review_result,
    categoryIsNew: Boolean(t.category_id && categoryById.get(t.category_id)?.created_by === "model"),
    messageCount: Number(t.message_count ?? 0),
  }));

  const status = ((statusRes.data ?? []) as Array<Record<string, unknown>>)[0] ?? {};

  return {
    runs,
    provider: {
      label: providers[0]?.label ?? null,
      batchApiInUse: false,
    },
    quality: { ...quality, calibration: confidenceCalibration(reviewed) },
    accuracyWeeks: accuracyByWeek(
      texts.map((t) => ({ reviewedAt: t.reviewed_at, reviewResult: t.review_result })),
      lastWeeks(now, 7),
    ),
    mostCorrected: mostCorrectedCategories(
      texts.map((t) => ({
        categoryId: t.category_id,
        categoryName: t.category_id ? (categoryById.get(t.category_id)?.name ?? null) : null,
        source: t.source,
        reviewResult: t.review_result,
      })),
    ),
    reviewCandidates: reviewQueue(candidates),
    classification: {
      lastRunAt: (status.last_run_at as string | null) ?? null,
      lastRunStatus: (status.last_run_status as string | null) ?? null,
      classifiedToday: Number(status.texts_classified_today ?? 0),
      unclassifiedPending: Number(status.unclassified_pending ?? 0),
      activePromptVersion: status.active_prompt_version === null || status.active_prompt_version === undefined ? null : Number(status.active_prompt_version),
      // El set de control se arma solo: son las filas que alguien reviso o corrigio.
      controlSetSize: texts.filter((t) => t.review_result !== null || t.source === "human").length,
    },
    recentRuns: ((recentRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      at: (r.completed_at as string | null) ?? (r.created_at as string | null) ?? null,
      source: String(r.source),
      status: String(r.status),
      detail: (r.status_detail as string | null) ?? null,
      model: (r.model as string | null) ?? null,
      costUsd: r.cost_usd === null || r.cost_usd === undefined ? null : Number(r.cost_usd),
    })),
    buttonTexts: texts
      .filter((t) => t.is_button)
      .map((t) => ({ textId: t.text_id, text: t.sample_text ?? "", messageCount: Number(t.message_count ?? 0) }))
      .sort((a, b) => b.messageCount - a.messageCount || a.text.localeCompare(b.text, "es")),
  };
}

/** Las categorias activas, para el selector de la revision rapida. */
export async function loadReviewCategories(workspaceId: string): Promise<Array<{ id: string; name: string; direction: string }>> {
  const service = await createServiceClient();
  const { data } = await service
    .from("message_categories")
    .select("id, name, direction, archived_at")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("name");
  return ((data ?? []) as Array<{ id: string; name: string; direction: string }>).map((c) => ({
    id: c.id,
    name: c.name,
    direction: c.direction,
  }));
}
