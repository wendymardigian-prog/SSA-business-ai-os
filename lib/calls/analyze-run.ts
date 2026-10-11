/**
 * Analizar UNA llamada de punta a punta (F20–F22). Es lo que corre el job
 * `call_analyze`; el handler es fino y todo lo que decide vive aca, con la base
 * y el modelo por parametro.
 *
 * Orden: tope de gasto -> claim condicional del estado -> instrucciones, rubrica
 * y modelo -> run registrado -> analisis -> guardar. Nada se guarda a medias:
 * `analysis_ai` (lo que dijo la IA, inmutable) y `analysis` (lo que se muestra y
 * se corrige) se escriben en el mismo update, con un `analysis_run_id` NUEVO,
 * que es lo que el trigger `calls_protect_analysis_ai` exige para dejarlo.
 *
 * Un fallo del modelo no lanza: se reintenta a los 1, 5 y 15 minutos; una
 * respuesta cortada por largo es un error definitivo; un objeto que no cumple el
 * esquema deja la llamada "Por revisar".
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallLeadQualification, Database, Json } from "@/lib/types/database";
import { auditAsSystem, logAudit } from "@/lib/audit";
import { openAiRun } from "@/lib/ai/run";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { resolveTaskModel } from "@/lib/ai-tasks/model";
import { loadTaskInstructions } from "@/lib/ai-tasks/store";
import { getJobHandler } from "@/lib/jobs/registry";
import { aiSdkGenerate, type GenerateFn } from "./ai-generate";
import { decideAiFailure } from "./ai-retry";
import { runCallAnalysis } from "./analyze";
import { buildStoredAnalysis } from "./analysis-store";
import { notifyBudgetBlocked } from "./notify";
import { enqueueCallJob } from "./queue";
import { resolveCallTaskSettings } from "./task-settings";

type Db = SupabaseClient<Database>;

export type AnalyzeOutcome =
  | "gone" // no existe o esta archivada
  | "not_claimable" // otro proceso la tiene, o ya esta analizada
  | "no_transcript"
  | "budget"
  | "analyzed"
  | "retry" // fallo el modelo, se reintenta
  | "error" // fallo definitivo
  | "needs_review"; // el modelo devolvio algo que no cumple el esquema

export interface AnalyzeJobPayload {
  callId: string;
  /** Cuantas veces ya se reintento por un fallo del modelo. */
  retry?: number;
  /** Lo pidio una persona: se puede volver a analizar una llamada ya analizada o por revisar. */
  manual?: boolean;
  /** Quien lo pidio, para firmar la auditoria. */
  requestedBy?: string | null;
  /** "Regenerar con motivo": lo que agrega la persona como contexto. */
  extraContext?: string | null;
  /** El motivo elegido al regenerar (queda en la auditoria). */
  reason?: string | null;
}

export interface AnalyzeDeps {
  db: Db;
  now?: Date;
  /** Para los tests. Sin esto se resuelve el modelo de la tarea. */
  generate?: GenerateFn;
}

const AUTO_CLAIMABLE = ["pending"] as const;
const MANUAL_CLAIMABLE = ["pending", "error", "needs_review", "analyzed", "not_applicable"] as const;

const CALL_COLUMNS = "id, workspace_id, title, call_type, transcript, contact_id, analysis_status, closer_score, lead_score";

export async function runCallAnalysisJob(deps: AnalyzeDeps, payload: AnalyzeJobPayload): Promise<{ outcome: AnalyzeOutcome }> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const { callId } = payload;
  const retry = payload.retry ?? 0;
  const claimable = payload.manual ? MANUAL_CLAIMABLE : AUTO_CLAIMABLE;

  const { data: peek } = await db.from("calls").select("id, workspace_id, transcript").eq("id", callId).is("archived_at", null).maybeSingle();
  if (!peek) return { outcome: "gone" };
  const workspaceId = peek.workspace_id;

  if (!Array.isArray(peek.transcript) || peek.transcript.length === 0) {
    await db.from("calls").update({ analysis_status: "needs_review", analysis_status_reason: "no_transcript" }).eq("id", callId).in("analysis_status", [...claimable]);
    return { outcome: "no_transcript" };
  }

  const budget = await withinWorkspaceBudget(db, workspaceId, now);
  if (!budget.allowed) {
    await db.from("calls").update({ analysis_status: "pending", analysis_status_reason: "budget" }).eq("id", callId).in("analysis_status", [...claimable]);
    await notifyBudgetBlocked(db, workspaceId, callId);
    return { outcome: "budget" };
  }

  // El claim: solo uno de dos procesos que llegan a la vez se queda con la llamada.
  const { data: claimed } = await db
    .from("calls")
    .update({ analysis_status: "analyzing", analysis_status_reason: null, analysis_error: null })
    .eq("id", callId)
    .in("analysis_status", [...claimable])
    .select("id");
  if (!claimed || claimed.length === 0) return { outcome: "not_claimable" };

  const { data: call } = await db.from("calls").select(CALL_COLUMNS).eq("id", callId).maybeSingle();
  if (!call) return { outcome: "gone" };

  const { data: ws } = await db.from("workspaces").select("ai_background_settings").eq("id", workspaceId).maybeSingle();
  const settings = resolveCallTaskSettings(ws?.ai_background_settings).call_analysis;

  const [model, instructions] = await Promise.all([
    resolveTaskModel(db, workspaceId, "call_analysis"),
    loadTaskInstructions(db, workspaceId, "call_analysis"),
  ]);
  if (!deps.generate && (!model.ok || !model.model)) {
    return fail(db, callId, "error", model.message ?? "No hay un proveedor de IA conectado", "ai_error");
  }

  const run = await openAiRun(db, {
    workspaceId,
    source: "call_analysis",
    trigger: payload.manual ? "manual" : "job",
    promptVersion: instructions.version,
    contactId: call.contact_id,
    threadId: call.id,
  });
  if (model.provider && model.modelId) run.setModel(model.provider, model.modelId);
  const generate = deps.generate ?? aiSdkGenerate(model.model!);
  const startedAt = Date.now();

  const result = await runCallAnalysis({
    call,
    rubric: settings.rubric,
    categories: settings.categories,
    allowNewCategories: settings.allow_new_categories,
    companyContext: settings.company_context,
    instructions: instructions.text,
    extraContext: payload.extraContext,
    generate,
  });

  if (!result.ok) {
    await run.close({ status: "error", statusDetail: result.kind === "truncated" ? "truncated" : "generation_failed", error: result.error.slice(0, 300) });
    if (result.kind === "truncated") return fail(db, callId, "error", result.error, null);
    if (result.kind === "schema") {
      await db.from("calls").update({ analysis_status: "needs_review", analysis_status_reason: "schema", analysis_error: result.error.slice(0, 300) }).eq("id", callId);
      return { outcome: "needs_review" };
    }
    const decision = decideAiFailure(result.cause, retry);
    if (decision.action === "retry") {
      await db.from("calls").update({ analysis_status: "pending", analysis_status_reason: null }).eq("id", callId);
      await enqueueCallJob(db, "call_analyze", callId, now, { ...payload, retry: decision.nextRetry }, new Date(now.getTime() + decision.delayMs));
      return { outcome: "retry" };
    }
    return fail(db, callId, "error", decision.message, null);
  }

  run.setFinalUsage(result.usage);
  await run.step({
    kind: "model_call",
    name: `${model.provider ?? "ia"}/${model.modelId ?? "modelo"}`,
    output: { closer_score: result.scores.closer_score, lead_score: result.scores.lead_score },
    durationMs: Date.now() - startedAt,
  });
  const closed = await run.close({ status: "responded" });

  const modelLabel = model.provider && model.modelId ? `${model.provider}/${model.modelId}` : "modelo";
  const stored = buildStoredAnalysis({
    analysis: result.analysis as unknown as Record<string, unknown>,
    scores: result.scores,
    transcriptText: result.transcriptText,
    model: modelLabel,
    costUsd: closed.costUsd ?? 0,
    promptVersion: instructions.version,
    rubricVersion: settings.rubric.version,
    generatedAt: now.toISOString(),
  });

  const autoSummary = settings.auto_summary && Boolean(getJobHandler("call_summary"));
  const citas = (stored.citas_verificadas ?? { total: 0, verificadas: 0 }) as { total: number; verificadas: number };

  const { error: writeError } = await db
    .from("calls")
    .update({
      analysis_ai: stored as unknown as Json,
      analysis: stored as unknown as Json,
      analysis_edited: false,
      closer_score: result.scores.closer_score,
      lead_score: result.scores.lead_score,
      lead_qualification: (stored.lead_qualification as CallLeadQualification | null) ?? null,
      outcome: (stored.outcome as string | null) ?? null,
      main_objection: (stored.main_objection as string | null) ?? null,
      followup_at: (stored.followup_at as string | null) ?? null,
      has_open_alerts: Boolean(stored.has_open_alerts),
      quotes_total: citas.total,
      quotes_verified: citas.verificadas,
      analysis_prompt_version: instructions.version,
      rubric_snapshot: settings.rubric as unknown as Json,
      rubric_version: settings.rubric.version,
      analysis_model: modelLabel,
      // Tiene que cambiar en CADA analisis: es lo que el trigger de inmutabilidad exige.
      analysis_run_id: run.runId ?? randomUUID(),
      analyzed_at: now.toISOString(),
      analysis_status: "analyzed",
      analysis_status_reason: null,
      analysis_error: null,
      ...(autoSummary ? { summary_status: "pending" as const } : {}),
    })
    .eq("id", callId);
  if (writeError) return fail(db, callId, "error", "No pude guardar el análisis", null);

  const audit = {
    supabase: db,
    workspaceId,
    entityType: "call" as const,
    entityId: callId,
    action: "call.analyzed" as const,
    changes: {
      analysis_status: { old: call.analysis_status, new: "analyzed" },
      closer_score: { old: call.closer_score, new: result.scores.closer_score },
      lead_score: { old: call.lead_score, new: result.scores.lead_score },
    },
    metadata: {
      prompt_version: instructions.version,
      rubric_version: settings.rubric.version,
      model: modelLabel,
      cost_usd: closed.costUsd,
      ...(payload.reason ? { reason: payload.reason } : {}),
    } as Record<string, Json>,
  };
  if (payload.requestedBy) await logAudit({ ...audit, performedBy: payload.requestedBy });
  else await auditAsSystem({ ...audit, label: "Análisis automático" });

  if (autoSummary) await enqueueCallJob(db, "call_summary", callId, now);
  if (settings.auto_knowledge && getJobHandler("call_index_knowledge")) await enqueueCallJob(db, "call_index_knowledge", callId, now);
  return { outcome: "analyzed" };
}

async function fail(db: Db, callId: string, status: "error", message: string, reason: string | null): Promise<{ outcome: AnalyzeOutcome }> {
  await db.from("calls").update({ analysis_status: status, analysis_status_reason: reason, analysis_error: message.slice(0, 300) }).eq("id", callId);
  return { outcome: "error" };
}
