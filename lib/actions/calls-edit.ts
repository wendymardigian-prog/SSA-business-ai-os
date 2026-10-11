"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { openAiRun } from "@/lib/ai/run";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { resolveTaskModel } from "@/lib/ai-tasks/model";
import { aiSdkGenerate } from "@/lib/calls/ai-generate";
import { proposeCorrection, type CorrectionResult } from "@/lib/calls/correction";
import { enqueueCallJob } from "@/lib/calls/queue";
import {
  ANALYZE_PENDING_LIMIT,
  ANALYZE_PENDING_SPACING_MS,
  REGENERATE_CONTEXT_MAX,
  REGENERATE_CONTEXT_MIN,
  REGENERATE_REASONS,
  type SectionOrigin,
} from "@/lib/calls/edit-rules";
import { applySectionEdits, type SectionEdit } from "@/lib/calls/section-edit";
import { isAnalysisSection } from "@/lib/calls/scoring";
import { canAnalyze, nextStatusAfterClassify } from "@/lib/calls/status";
import { resolveCallTaskSettings, validTypeKeys } from "@/lib/calls/task-settings";
import { transcriptText } from "@/lib/calls/transcript-text";
import type { Json } from "@/lib/types/database";

/**
 * Editar una llamada y su analisis (F18, F22 a F25). Todo con `calls.edit`.
 *
 * Dos reglas que valen para todas:
 *  - Lo que se LEE para decidir se lee con el cliente de QUIEN EDITA: la RLS
 *    (`can_see_call`) decide que llamadas ve. Una llamada que no ve es como si
 *    no existiera.
 *  - Lo que se ESCRIBE va con el cliente de servicio: `calls` no tiene policy
 *    de escritura. El workspace sale siempre de la sesion, nunca del pedido.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_ALLOWED = "No tenés permiso para editar llamadas";
const NOT_FOUND = "No encontré esa llamada";

type Ctx = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;
export type CallEditResult = { ok: true; message?: string } | { ok: false; error: string };

function refresh(callId: string) {
  revalidatePath(`/dashboard/llamadas/${callId}`);
  revalidatePath("/dashboard/llamadas");
}

async function loadSettings(workspaceId: string) {
  const service = await createServiceClient();
  const { data } = await service.from("workspaces").select("ai_background_settings").eq("id", workspaceId).maybeSingle();
  return { service, settings: resolveCallTaskSettings(data?.ai_background_settings) };
}

// ── F18: cambiar el tipo ──────────────────────────────────────────────────

export async function changeCallType(input: { callId: string; type: string }): Promise<CallEditResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!UUID.test(input.callId)) return { ok: false, error: "Los datos no son válidos" };

  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, call_type, analysis_status, transcript")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: NOT_FOUND };

  const { service, settings } = await loadSettings(ctx.workspace.id);
  if (!validTypeKeys(settings.call_classification.custom_types).includes(input.type)) return { ok: false, error: "Ese tipo de llamada no existe" };
  if (call.call_type === input.type) return { ok: true };

  // El estado solo se mueve mientras la llamada espera: una analizada o en curso no se toca.
  const movable = ["classifying", "needs_review", "pending", "not_applicable", "error"].includes(call.analysis_status);
  const analysis = settings.call_analysis;
  const next = nextStatusAfterClassify(input.type, {
    analyzeTypes: analysis.analyze_types,
    auto: analysis.mode === "now",
    hasTranscript: Array.isArray(call.transcript) && call.transcript.length > 0,
  });

  const { error } = await service
    .from("calls")
    .update({
      call_type: input.type,
      call_type_source: "human",
      call_type_rule: null,
      call_type_confidence: null,
      call_type_alternative: null,
      call_type_proposed: null,
      ...(movable ? { analysis_status: next.status, analysis_status_reason: next.reason, analysis_error: null } : {}),
    })
    .eq("id", call.id);
  if (error) {
    console.error("[llamadas] no pude cambiar el tipo:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }
  if (movable && next.enqueueAnalysis) await enqueueCallJob(service, "call_analyze", call.id);

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "call",
    entityId: call.id,
    action: "call.type_changed",
    changes: { call_type: { old: call.call_type, new: input.type } },
    metadata: { source: "human" },
    performedBy: ctx.user.id,
  });
  refresh(call.id);
  return { ok: true };
}

// ── F22: analizar a mano ──────────────────────────────────────────────────

export async function analyzeCall(input: { callId: string }): Promise<CallEditResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!UUID.test(input.callId)) return { ok: false, error: "Los datos no son válidos" };

  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, call_type, analysis_status, transcript")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: NOT_FOUND };
  if (call.analysis_status === "analyzed") return { ok: false, error: "Ya está analizada. Para volver a hacerlo, usá Regenerar." };

  const { service, settings } = await loadSettings(ctx.workspace.id);
  const check = canAnalyze({
    status: call.analysis_status,
    callType: call.call_type,
    analyzeTypes: settings.call_analysis.analyze_types,
    hasTranscript: Array.isArray(call.transcript) && call.transcript.length > 0,
    canEdit: true,
  });
  if (!check.ok) return { ok: false, error: check.reason ?? "No se puede analizar" };

  const { queued } = await enqueueCallJob(service, "call_analyze", call.id, new Date(), { manual: true, requestedBy: ctx.user.id });
  if (!queued) return { ok: false, error: "Ya hay un análisis en la cola para esta llamada" };
  refresh(call.id);
  return { ok: true, message: "Se está analizando" };
}

/** "Analizar pendientes": hasta 20 de las que la persona ve, una cada 30 segundos (para no pegarle de golpe al proveedor). */
export async function analyzePendingCalls(): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const { service, settings } = await loadSettings(ctx.workspace.id);
  const { data: pending } = await ctx.supabase
    .from("calls")
    .select("id, call_type")
    .eq("workspace_id", ctx.workspace.id)
    .eq("analysis_status", "pending")
    .is("archived_at", null)
    .in("call_type", settings.call_analysis.analyze_types)
    .order("recorded_at", { ascending: false })
    .limit(ANALYZE_PENDING_LIMIT);

  const now = new Date();
  let queued = 0;
  for (const [i, call] of (pending ?? []).entries()) {
    const runAt = new Date(now.getTime() + i * ANALYZE_PENDING_SPACING_MS);
    const res = await enqueueCallJob(service, "call_analyze", call.id, now, { manual: true, requestedBy: ctx.user.id }, runAt);
    if (res.queued) queued += 1;
  }
  refresh("");
  return { ok: true, queued };
}

// ── F23: corregir a mano / F24: aceptar una correccion de la IA ───────────

export async function saveCallSections(input: { callId: string; edits: SectionEdit[]; origin: SectionOrigin; request?: string }): Promise<CallEditResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!UUID.test(input.callId) || !Array.isArray(input.edits)) return { ok: false, error: "Los datos no son válidos" };
  if (input.origin !== "manual" && input.origin !== "ai_correction") return { ok: false, error: "Los datos no son válidos" };

  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, call_type, analysis, rubric_snapshot, transcript, analysis_status, updated_at")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: NOT_FOUND };
  if (call.analysis_status !== "analyzed" || !call.analysis) return { ok: false, error: "La llamada todavía no tiene un análisis para corregir" };

  const applied = applySectionEdits(call.analysis, input.edits, {
    rubric: (call.rubric_snapshot ?? null) as never,
    callType: call.call_type,
    transcript: transcriptText(call.transcript),
  });
  if (!applied.ok) return { ok: false, error: applied.error };

  const service = await createServiceClient();
  const { data: updated, error } = await service
    .from("calls")
    .update({ analysis: applied.analysis as unknown as Json, analysis_edited: true, ...applied.columns })
    .eq("id", call.id)
    // Si alguien guardo en el medio, no se pisa su cambio.
    .eq("updated_at", call.updated_at)
    .select("id");
  if (error) {
    console.error("[llamadas] no pude guardar la corrección:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }
  if (!updated || updated.length === 0) return { ok: false, error: "Otra persona modificó esta llamada mientras la editabas. Recargá y volvé a intentar." };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "call",
    entityId: call.id,
    action: "call.section_edited",
    changes: Object.fromEntries(applied.changes.map((c) => [c.section, { old: (c.before ?? null) as Json, new: (c.after ?? null) as Json }])),
    metadata: { origin: input.origin, ...(input.request ? { pedido: input.request.slice(0, 2000) } : {}) },
    performedBy: ctx.user.id,
  });
  refresh(call.id);
  return { ok: true };
}

/** Lo que vuelve al navegador: sin la causa tecnica del error. */
export type CorrectionView = Exclude<CorrectionResult, { status: "error" }> | { status: "error"; kind: string; error: string };

export async function proposeSectionCorrection(input: { callId: string; section: string; pedido: string }): Promise<CorrectionView> {
  const fail = (error: string): CorrectionView => ({ status: "error", kind: "invalid_input", error });
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return fail(NOT_ALLOWED);
  if (!UUID.test(input.callId) || !isAnalysisSection(input.section)) return fail("Los datos no son válidos");

  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, contact_id, analysis, transcript")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return fail(NOT_FOUND);

  const service = await createServiceClient();
  const budget = await withinWorkspaceBudget(service, ctx.workspace.id);
  if (!budget.allowed) return fail(budget.message ?? "Se alcanzó el tope de gasto de IA");

  const model = await resolveTaskModel(service, ctx.workspace.id, "call_analysis");
  if (!model.ok || !model.model) return fail(model.message ?? "No hay un proveedor de IA conectado");

  const run = await openAiRun(service, { workspaceId: ctx.workspace.id, source: "call_correction", trigger: "manual", contactId: call.contact_id, threadId: call.id });
  if (model.provider && model.modelId) run.setModel(model.provider, model.modelId);

  let usage: Parameters<typeof run.setFinalUsage>[0];
  const base = aiSdkGenerate(model.model);
  const result = await proposeCorrection({
    section: input.section,
    instruction: input.pedido,
    analysis: call.analysis,
    transcriptText: transcriptText(call.transcript),
    generate: async (args) => {
      const out = await base(args);
      usage = out.usage;
      return out;
    },
  });
  run.setFinalUsage(usage);
  await run.close(result.status === "error" ? { status: "error", statusDetail: result.kind, error: result.error.slice(0, 300) } : { status: "responded" });

  if (result.status === "error") return { status: "error", kind: result.kind, error: result.error };
  return result;
}

// ── F25: regenerar con motivo ─────────────────────────────────────────────

export async function regenerateCall(input: { callId: string; reason: string; context?: string }): Promise<CallEditResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!UUID.test(input.callId)) return { ok: false, error: "Los datos no son válidos" };
  if (!(REGENERATE_REASONS as readonly string[]).includes(input.reason)) return { ok: false, error: "Elegí el motivo para regenerar" };

  const context = input.context?.trim() ?? "";
  if (input.reason === "falta_contexto" && (context.length < REGENERATE_CONTEXT_MIN || context.length > REGENERATE_CONTEXT_MAX)) {
    return { ok: false, error: `Contá qué contexto faltaba (entre ${REGENERATE_CONTEXT_MIN} y ${REGENERATE_CONTEXT_MAX} caracteres)` };
  }

  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, analysis_status, analysis, analysis_ai")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: NOT_FOUND };
  if (!["analyzed", "error", "needs_review"].includes(call.analysis_status)) return { ok: false, error: "Solo se puede regenerar una llamada analizada o con error" };

  const service = await createServiceClient();
  // La foto del analisis anterior vive en el historial, ANTES de la corrida nueva.
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "call",
    entityId: call.id,
    action: "call.regenerated",
    changes: { analysis: { old: (call.analysis ?? null) as Json, new: null }, analysis_ai: { old: (call.analysis_ai ?? null) as Json, new: null } },
    metadata: { motivo: input.reason, ...(context ? { contexto: context } : {}) },
    performedBy: ctx.user.id,
  });

  const { queued } = await enqueueCallJob(service, "call_analyze", call.id, new Date(), {
    manual: true,
    requestedBy: ctx.user.id,
    reason: input.reason,
    // El texto SI llega al analisis (en prevxcrm se perdia por el camino).
    ...(input.reason === "falta_contexto" ? { extraContext: context } : {}),
  });
  if (!queued) return { ok: false, error: "Ya hay un análisis en la cola para esta llamada" };
  refresh(call.id);
  return { ok: true, message: "Se está regenerando" };
}
