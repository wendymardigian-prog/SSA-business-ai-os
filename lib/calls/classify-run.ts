/**
 * Clasificar UNA llamada de punta a punta (F17, F18). Es lo que corre el job
 * `call_classify`; el handler es fino y todo lo que decide vive aca, con la base
 * y el modelo por parametro.
 *
 * Orden:
 *   1. Un tipo puesto por una persona (`call_type_source = 'human'`) NO se pisa.
 *   2. Las reglas del negocio deciden primero, sin gastar IA.
 *   3. Si ninguna decide y la clasificacion con IA esta prendida: se respeta el
 *      tope de gasto, se abre el run y se pregunta al modelo.
 *   4. El estado de la llamada sale de `nextStatusAfterClassify`; con el modo
 *      automatico prendido, se encola el analisis.
 *
 * Un fallo del modelo NO lanza: se reintenta a los 1, 5 y 15 minutos (propio) y,
 * agotado, la llamada queda "Por revisar" para que una persona elija el tipo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { auditAsSystem } from "@/lib/audit";
import { openAiRun } from "@/lib/ai/run";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { resolveTaskModel } from "@/lib/ai-tasks/model";
import { loadTaskInstructions } from "@/lib/ai-tasks/store";
import { aiSdkGenerate, type GenerateFn } from "./ai-generate";
import { decideAiFailure } from "./ai-retry";
import { classifyCallWithAi } from "./classify-ai";
import { applyClassificationRules, teamNamesFrom } from "./classification";
import { enqueueCallJob } from "./queue";
import { nextStatusAfterClassify } from "./status";
import { resolveCallTaskSettings } from "./task-settings";

type Db = SupabaseClient<Database>;

export type ClassifyOutcome =
  | "gone" // la llamada no existe o esta archivada
  | "kept_human" // un humano ya eligio el tipo
  | "rule" // decidio una regla
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
  "id, workspace_id, title, duration_seconds, attendees, transcript, booking_id, contact_id, call_type, call_type_source, analysis_status";

async function loadTeam(db: Db, workspaceId: string): Promise<{ emails: string[]; names: string[] }> {
  const { data, error } = await db.rpc("workspace_member_profiles", { p_workspace_id: workspaceId });
  if (error || !data) return { emails: [], names: [] };
  return {
    emails: data.map((m) => m.email ?? "").filter(Boolean),
    names: teamNamesFrom(data.map((m) => ({ full_name: m.full_name ?? m.meta_name ?? null }))),
  };
}

export async function runCallClassification(deps: ClassifyDeps, callId: string, retry = 0): Promise<{ outcome: ClassifyOutcome }> {
  const { db } = deps;
  const now = deps.now ?? new Date();

  const { data: call } = await db.from("calls").select(CALL_COLUMNS).eq("id", callId).is("archived_at", null).maybeSingle();
  if (!call) return { outcome: "gone" };

  const { data: ws } = await db.from("workspaces").select("ai_background_settings").eq("id", call.workspace_id).maybeSingle();
  const settings = resolveCallTaskSettings(ws?.ai_background_settings);
  const classification = settings.call_classification;
  const analysis = settings.call_analysis;
  const hasTranscript = Array.isArray(call.transcript) && call.transcript.length > 0;

  // Paso el estado a su lugar sin tocar el tipo que puso una persona.
  if (call.call_type_source === "human" && call.call_type) {
    if (call.analysis_status === "classifying") {
      const next = nextStatusAfterClassify(call.call_type, { analyzeTypes: analysis.analyze_types, auto: analysis.mode === "now", hasTranscript });
      await db.from("calls").update({ analysis_status: next.status, analysis_status_reason: next.reason }).eq("id", callId).eq("analysis_status", "classifying");
      if (next.enqueueAnalysis) await enqueueCallJob(db, "call_analyze", callId, now);
    }
    return { outcome: "kept_human" };
  }

  const team = await loadTeam(db, call.workspace_id);
  const rule = applyClassificationRules(call, classification.rules, team.emails, team.names);

  let type: string | null = null;
  let source: "rule" | "ai" | null = null;
  let rowExtra: Record<string, unknown> = {};
  let lowConfidence = false;
  let reasonOverride: string | null = null;
  let outcome: ClassifyOutcome = "no_decision";

  if (rule) {
    type = rule.call_type;
    source = "rule";
    rowExtra = { call_type_rule: rule.rule_label, call_type_confidence: null, call_type_alternative: null, call_type_proposed: null };
    outcome = "rule";
  } else if (classification.mode === "off" || !hasTranscript) {
    reasonOverride = hasTranscript ? "ai_off" : "no_transcript";
  } else {
    const budget = await withinWorkspaceBudget(db, call.workspace_id, now);
    if (!budget.allowed) {
      await db.from("calls").update({ analysis_status: "needs_review", analysis_status_reason: "budget" }).eq("id", callId).eq("analysis_status", "classifying");
      return { outcome: "budget" };
    }

    const [model, instructions] = await Promise.all([
      resolveTaskModel(db, call.workspace_id, "call_classification"),
      loadTaskInstructions(db, call.workspace_id, "call_classification"),
    ]);
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

    const result = await classifyCallWithAi({ call, settings: classification, instructions: instructions.text, generate });
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
    await run.step({ kind: "model_call", name: `${model.provider ?? "ia"}/${model.modelId ?? "modelo"}`, output: { tipo: result.decision.type, confianza: result.decision.confidence }, durationMs: Date.now() - startedAt });
    await run.close({ status: "responded" });

    const d = result.decision;
    type = d.type;
    source = "ai";
    lowConfidence = d.lowConfidence;
    rowExtra = { call_type_rule: null, call_type_confidence: d.confidence, call_type_alternative: d.alternative, call_type_proposed: d.proposed };
    outcome = "ai";
  }

  if (type && source) {
    const next = nextStatusAfterClassify(type, { analyzeTypes: analysis.analyze_types, auto: analysis.mode === "now", lowConfidence, hasTranscript });
    const { data: updated } = await db
      .from("calls")
      .update({ call_type: type, call_type_source: source, ...rowExtra, analysis_status: next.status, analysis_status_reason: next.reason })
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
        changes: { call_type: { old: call.call_type, new: type } },
        metadata: { source, ...(rule ? { rule: rule.rule_label } : {}) },
        label: "Clasificación automática",
      });
    }
    return { outcome };
  }

  // Nada decidio: queda para que alguien elija el tipo.
  await db
    .from("calls")
    .update({ analysis_status: "needs_review", analysis_status_reason: reasonOverride ?? "ai_off" })
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

