/**
 * Clasificar UNA llamada de punta a punta (F17, F18). Es lo que corre el job
 * `call_classify`; el handler es fino y todo lo que decide vive aca, con la base
 * y el modelo por parametro.
 *
 * Orden (`classify-cascade.ts`):
 *   1. Lo que eligio una persona NO se pisa.
 *   2. La reunion vinculada: su area y su tipo.
 *   3. Las reglas del negocio, sin gastar IA.
 *   4. El area por defecto de la conexion (Etapa 2).
 *   5. La IA, solo si lo anterior no dio el tipo: se respeta el tope de gasto, se abre
 *      el run y se pregunta al modelo. Con un area ya decidida, solo completa el tipo.
 *   6. El estado de la llamada sale de `nextStatusAfterClassify`; con el modo
 *      automatico prendido, se encola el analisis.
 *
 * Un fallo del modelo NO lanza: se reintenta a los 1, 5 y 15 minutos (propio) y,
 * agotado, la llamada queda "Por revisar" para que una persona elija. Lo que ya se
 * sabia (el area) queda guardado antes de preguntar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { auditAsSystem } from "@/lib/audit";
import { openAiRun } from "@/lib/ai/run";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { resolveTaskModel } from "@/lib/ai-tasks/model";
import { loadTaskInstructionsForRun } from "@/lib/ai-tasks/store";
import { categorySnapshot } from "@/lib/scheduling/categories";
import { aiSdkGenerate, type GenerateFn } from "./ai-generate";
import { decideAiFailure } from "./ai-retry";
import { classifierOptions, callCategoryLabel } from "./catalog";
import { classifyCallWithAi } from "./classify-ai";
import { needsAi, resolveCascade } from "./classify-cascade";
import { classificationPatch, loadClassificationContext } from "./classify-core";
import { enqueueCallJob } from "./queue";
import { nextStatusAfterClassify } from "./status";

type Db = SupabaseClient<Database>;

export type ClassifyOutcome =
  | "gone" // la llamada no existe o esta archivada
  | "kept_human" // una persona ya eligio
  | "booking" // decidio la reunion vinculada
  | "rule" // decidio una regla
  | "connection" // decidio el area de la conexion
  | "ai" // decidio la IA
  | "no_decision" // nada decidio y la IA esta apagada
  | "budget" // frenada por el tope de gasto
  | "retry" // fallo el modelo, se reintenta
  | "failed"; // fallo el modelo y se agotaron los intentos

export interface ClassifyDeps {
  db: Db;
  now?: Date;
  /** Para los tests. Sin esto se resuelve el modelo de la tarea. */
  generate?: GenerateFn;
}

const CALL_COLUMNS =
  "id, workspace_id, title, duration_seconds, attendees, transcript, booking_id, contact_id, call_type, call_type_source, classification_source, no_show, analysis_status, imported_from_history";

export async function runCallClassification(deps: ClassifyDeps, callId: string, retry = 0): Promise<{ outcome: ClassifyOutcome }> {
  const { db } = deps;
  const now = deps.now ?? new Date();

  const { data: call } = await db.from("calls").select(CALL_COLUMNS).eq("id", callId).is("archived_at", null).maybeSingle();
  if (!call) return { outcome: "gone" };

  const ctx = await loadClassificationContext(db, call);
  const classification = ctx.settings.call_classification;
  const analysis = ctx.settings.call_analysis;
  const hasTranscript = Array.isArray(call.transcript) && call.transcript.length > 0;
  // Lo importado del historial no se analiza solo: el gasto lo decide una persona, llamada por llamada.
  const auto = analysis.mode === "now" && !call.imported_from_history;

  // Paso el estado a su lugar sin tocar lo que eligio una persona.
  if ((call.classification_source === "human" || call.call_type_source === "human") && call.call_type) {
    if (call.analysis_status === "classifying") {
      const next = nextStatusAfterClassify(call.call_type, { analyzeTypes: analysis.analyze_types, auto, hasTranscript });
      await db.from("calls").update({ analysis_status: next.status, analysis_status_reason: next.reason }).eq("id", callId).eq("analysis_status", "classifying");
      if (next.enqueueAnalysis) await enqueueCallJob(db, "call_analyze", callId, now);
    }
    return { outcome: "kept_human" };
  }

  const noShow = call.no_show || ctx.noShowRule;
  const base = resolveCascade({ booking: ctx.booking, rule: ctx.rule });
  let final = base;
  let ai: { confidence: number; alternative: string | null } | null = null;
  let lowConfidence = false;
  let reasonOverride: string | null = null;

  // Una llamada a la que nadie vino no vale una consulta a la IA.
  if (needsAi(base, ctx.categories) && !noShow) {
    if (classification.mode === "off" || !hasTranscript) {
      reasonOverride = hasTranscript ? "ai_off" : "no_transcript";
    } else {
      const budget = await withinWorkspaceBudget(db, call.workspace_id, now);
      if (!budget.allowed) {
        await db.from("calls").update({ ...classificationPatch(base, ctx, noShow), analysis_status: "needs_review", analysis_status_reason: "budget" }).eq("id", callId).eq("analysis_status", "classifying");
        return { outcome: "budget" };
      }

      const [model, instructions] = await Promise.all([
        resolveTaskModel(db, call.workspace_id, "call_classification"),
        loadTaskInstructionsForRun(db, call.workspace_id, "call_classification"),
      ]);
      // Lo que ya se sabe queda guardado: si la IA falla, no se pierde el area.
      if (base.snapshot) await db.from("calls").update(classificationPatch(base, ctx, noShow)).eq("id", callId).eq("analysis_status", "classifying");
      if (!deps.generate && (!model.ok || !model.model)) {
        return markFailed(deps, call.id, model.message ?? "No hay un proveedor de IA conectado", true);
      }

      const run = await openAiRun(db, {
        workspaceId: call.workspace_id,
        source: "call_classification",
        trigger: "job",
        promptVersion: instructions.version,
        contactId: call.contact_id,
        threadId: call.id,
      });
      if (model.provider && model.modelId) run.setModel(model.provider, model.modelId);
      const generate = deps.generate ?? aiSdkGenerate(model.model!);
      const startedAt = Date.now();

      const options = classifierOptions(ctx.categories, base.snapshot?.area_id);
      const result = await classifyCallWithAi({ call, options, confidenceThreshold: classification.confidence_threshold, instructions: instructions.text, generate });
      if (!result.ok) {
        await run.close({ status: "error", statusDetail: "generation_failed", error: result.error.slice(0, 300) });
        // Una respuesta que no cumple el esquema no se arregla reintentando: la decide una persona.
        if (isSchemaError(result.cause)) {
          await db.from("calls").update({ analysis_status: "needs_review", analysis_status_reason: "schema", analysis_error: result.error.slice(0, 300) }).eq("id", callId).eq("analysis_status", "classifying");
          return { outcome: "failed" };
        }
        const decision = decideAiFailure(result.cause, retry);
        return handleFailure(deps, call.id, result.error, retry, decision);
      }
      run.setFinalUsage(result.usage);
      const d = result.decision;
      await run.step({ kind: "model_call", name: `${model.provider ?? "ia"}/${model.modelId ?? "modelo"}`, output: { categoria: d.categoryId, confianza: d.confidence, valido: !d.invalidType }, durationMs: Date.now() - startedAt });
      await run.close({ status: "responded" });

      final = resolveCascade({ booking: ctx.booking, rule: ctx.rule, ai: d.categoryId ? categorySnapshot(d.categoryId, ctx.categories) : null });
      ai = { confidence: d.confidence, alternative: d.alternative };
      lowConfidence = d.lowConfidence;
    }
  }

  const patch = classificationPatch(final, ctx, noShow, ai);

  if (patch.call_type) {
    const next = nextStatusAfterClassify(patch.call_type, { analyzeTypes: analysis.analyze_types, auto, lowConfidence, hasTranscript });
    const { data: updated } = await db
      .from("calls")
      .update({ ...patch, analysis_status: next.status, analysis_status_reason: next.reason })
      .eq("id", callId)
      .or("call_type_source.is.null,call_type_source.neq.human")
      .select("id");
    if (updated && updated.length > 0) {
      if (next.enqueueAnalysis) await enqueueCallJob(db, "call_analyze", callId, now);
      await auditAsSystem({
        supabase: db,
        workspaceId: call.workspace_id,
        entityType: "call",
        entityId: callId,
        action: "call.type_changed",
        changes: { call_type: { old: call.call_type, new: patch.call_type } },
        metadata: { source: final.source ?? "rule", category: callCategoryLabel(final.snapshot), ...(patch.call_type_rule ? { rule: patch.call_type_rule } : {}) },
        label: "Clasificación automática",
      });
    }
    return { outcome: final.source ?? "rule" };
  }

  // Nada decidio: queda para que alguien elija.
  await db
    .from("calls")
    .update({ analysis_status: "needs_review", analysis_status_reason: lowConfidence ? "low_confidence" : reasonOverride ?? "ai_off" })
    .eq("id", callId)
    .eq("analysis_status", "classifying");
  return { outcome: "no_decision" };
}

function isSchemaError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "AI_NoObjectGeneratedError" || name === "AI_TypeValidationError" || name === "AI_JSONParseError";
}

async function handleFailure(
  deps: ClassifyDeps,
  callId: string,
  message: string,
  retry: number,
  decision: ReturnType<typeof decideAiFailure>,
): Promise<{ outcome: ClassifyOutcome }> {
  if (decision.action === "retry") {
    const now = deps.now ?? new Date();
    await enqueueCallJob(deps.db, "call_classify", callId, now, { retry: decision.nextRetry }, new Date(now.getTime() + decision.delayMs));
    return { outcome: "retry" };
  }
  return markFailed(deps, callId, message, decision.permanent);
}

async function markFailed(deps: ClassifyDeps, callId: string, message: string, permanent: boolean): Promise<{ outcome: ClassifyOutcome }> {
  void permanent;
  await deps.db
    .from("calls")
    .update({ analysis_status: "needs_review", analysis_status_reason: "ai_error", analysis_error: message.slice(0, 300) })
    .eq("id", callId)
    .eq("analysis_status", "classifying");
  return { outcome: "failed" };
}

