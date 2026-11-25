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
import { canAnalyze } from "@/lib/calls/status";
import { resolveProfile, statusAfterClassification } from "@/lib/calls/profiles";
import { loadCallProfiles } from "@/lib/calls/profiles-load";
import { resolveCallTaskSettings } from "@/lib/calls/task-settings";
import { churnReasonLabel, parseManualChurnCause, readChurnCause } from "@/lib/calls/churn";
import { callCategoryLabel, readCategorySnapshot } from "@/lib/calls/catalog";
import { derivedCallType } from "@/lib/calls/legacy-type";
import { categorySnapshot } from "@/lib/scheduling/categories";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { transcriptText } from "@/lib/calls/transcript-text";
import type { Json } from "@/lib/types/database";
import { BULK_TYPE_LIMIT, type BulkSkipReason } from "@/lib/calls/bulk";
import { RECLASSIFY_LIMIT, reclassifyDecision, type ReclassifySkip } from "@/lib/calls/reclassify-request";

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

// ── F18: cambiar el tipo ──────────────────────────────────────────────────

export async function changeCallType(input: { callId: string; categoryId: string }): Promise<CallEditResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!UUID.test(input.callId) || !UUID.test(input.categoryId)) return { ok: false, error: "Los datos no son válidos" };
  const service = await createServiceClient();
  const res = await applyCallType(ctx, service, input.callId, input.categoryId, { enqueue: true });
  if (res.ok) refresh(input.callId);
  return res;
}

type TypeEnv = { categories: ReturnType<typeof toCategoryRow>[]; profiles: Awaited<ReturnType<typeof loadCallProfiles>> };

/**
 * El núcleo de cambiar el tipo, para una o para varias (en grupo se carga el catálogo y los analizadores una sola vez).
 * Lee la grabación con la SESIÓN (la RLS decide si la ve) y escribe con el cliente de servicio. Confirmar el mismo tipo
 * que puso la IA en una «por revisar» también cuenta: queda como elegido por una persona y sale de la revisión.
 * `enqueue`: si al quedar clasificada corresponde analizarla sola (lo de siempre); en «Analizar con IA» en grupo, no,
 * porque las encola después el análisis, de a una.
 */
async function applyCallType(
  ctx: Ctx,
  service: Awaited<ReturnType<typeof createServiceClient>>,
  callId: string,
  categoryId: string,
  opts: { enqueue: boolean },
  env?: TypeEnv,
): Promise<CallEditResult> {
  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, title, duration_seconds, attendees, category_id, category_snapshot, no_show, analysis_status, transcript, imported_from_history")
    .eq("id", callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: NOT_FOUND };

  const categories = env?.categories ?? (await listCategories(service, ctx.workspace.id)).map(toCategoryRow);
  const chosen = categories.find((c) => c.id === categoryId && !c.archived_at);
  if (!chosen) return { ok: false, error: "Esa área o tipo ya no existe" };
  if (call.category_id === categoryId && call.analysis_status !== "needs_review") return { ok: true };

  const snapshot = categorySnapshot(categoryId, categories);

  // El estado solo se mueve mientras la llamada espera: una analizada o en curso no se toca.
  const movable = ["classifying", "needs_review", "pending", "not_applicable", "error"].includes(call.analysis_status);
  // Lo importado del historial no se analiza solo: se analiza con el boton.
  const profiles = env?.profiles ?? (await loadCallProfiles(service, ctx.workspace.id));
  const next = statusAfterClassification(resolveProfile(profiles, { categoryId, areaId: snapshot.area_id }), {
    transcript: call.transcript,
    title: call.title,
    duration_seconds: call.duration_seconds,
    attendees: call.attendees,
    noShow: call.no_show,
    importedFromHistory: call.imported_from_history,
  });

  const { error } = await service
    .from("calls")
    .update({
      area_id: snapshot.area_id,
      category_id: categoryId,
      category_snapshot: snapshot as unknown as Json,
      classification_source: "human",
      classification_rule: null,
      classification_confidence: null,
      ...(movable ? { analysis_status: next.status, analysis_status_reason: next.reason, analysis_error: null } : {}),
    })
    .eq("id", call.id);
  if (error) {
    console.error("[llamadas] no pude cambiar el tipo:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }
  if (opts.enqueue && movable && next.enqueueAnalysis) await enqueueCallJob(service, "call_analyze", call.id);

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "call",
    entityId: call.id,
    action: "call.type_changed",
    changes: { category: { old: callCategoryLabel(readCategorySnapshot(call.category_snapshot)), new: callCategoryLabel(snapshot) } },
    metadata: { source: "human", category: callCategoryLabel(snapshot) },
    performedBy: ctx.user.id,
  });
  return { ok: true };
}

async function loadTypeEnv(service: Awaited<ReturnType<typeof createServiceClient>>, workspaceId: string): Promise<TypeEnv> {
  const [categories, profiles] = await Promise.all([listCategories(service, workspaceId).then((rows) => rows.map(toCategoryRow)), loadCallProfiles(service, workspaceId)]);
  return { categories, profiles };
}

/** «Cambiar tipo» a varias grabaciones a la vez (selección múltiple). Mismo permiso y reglas que una sola. */
export async function changeCallTypeMany(input: { callIds: string[]; categoryId: string }): Promise<{ ok: true; changed: number; failed: number } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const ids = [...new Set(Array.isArray(input.callIds) ? input.callIds : [])];
  if (!UUID.test(input.categoryId) || ids.length === 0 || ids.length > BULK_TYPE_LIMIT || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return { ok: false, error: `Elegí entre 1 y ${BULK_TYPE_LIMIT} grabaciones` };
  }
  const service = await createServiceClient();
  const env = await loadTypeEnv(service, ctx.workspace.id);
  if (!env.categories.some((c) => c.id === input.categoryId && !c.archived_at)) return { ok: false, error: "Esa área o tipo ya no existe" };
  let changed = 0;
  let failed = 0;
  for (const id of ids) {
    const res = await applyCallType(ctx, service, id, input.categoryId, { enqueue: true }, env);
    if (res.ok) changed += 1;
    else failed += 1;
  }
  refresh("");
  return { ok: true, changed, failed };
}

/**
 * «Analizar con IA» en grupo: primero guarda el tipo de las que no lo tenían (o lo tenían por revisar), elegido por la
 * persona en la ventanita, y después encola el análisis de todas, de a una cada 30 segundos y hasta 20 (el mismo tope y
 * ritmo de «Analizar seleccionadas»). Devuelve cuántas se encolaron y por qué no las otras.
 */
export async function classifyAndAnalyzeCalls(input: {
  callIds: string[];
  types?: Array<{ callId: string; categoryId: string }>;
}): Promise<{ ok: true; queued: number; skipped: Partial<Record<BulkSkipReason, number>>; typeErrors: number } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const ids = [...new Set(Array.isArray(input.callIds) ? input.callIds : [])];
  if (ids.length === 0 || ids.length > ANALYZE_PENDING_LIMIT || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return { ok: false, error: `Elegí entre 1 y ${ANALYZE_PENDING_LIMIT} grabaciones` };
  }
  const types = Array.isArray(input.types) ? input.types : [];
  if (!types.every((t) => t && UUID.test(t.callId) && UUID.test(t.categoryId) && ids.includes(t.callId))) return { ok: false, error: "Los datos no son válidos" };

  const service = await createServiceClient();
  const env = await loadTypeEnv(service, ctx.workspace.id);
  let typeErrors = 0;
  for (const t of types) {
    const res = await applyCallType(ctx, service, t.callId, t.categoryId, { enqueue: false }, env);
    if (!res.ok) typeErrors += 1;
  }

  const { data } = await ctx.supabase
    .from("calls")
    .select("id, area_id, category_id, no_show, analysis_status, transcript")
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .in("id", ids);
  const skipped: Partial<Record<BulkSkipReason, number>> = {};
  const skip = (why: BulkSkipReason) => (skipped[why] = (skipped[why] ?? 0) + 1);
  const found = new Set((data ?? []).map((c) => c.id));
  for (const id of ids) if (!found.has(id)) skip("not_found");
  const eligible: Array<{ id: string; area_id: string | null; category_id: string | null }> = [];
  for (const c of data ?? []) {
    if (c.analysis_status === "analyzed") skip("analyzed");
    else if (c.analysis_status === "analyzing" || c.analysis_status === "classifying") skip("busy");
    else if (c.no_show) skip("no_show");
    else if (!Array.isArray(c.transcript) || c.transcript.length === 0) skip("no_transcript");
    else if (!c.area_id || c.analysis_status === "needs_review") skip("no_type");
    else if (!resolveProfile(env.profiles, { categoryId: c.category_id, areaId: c.area_id })) skip("no_profile");
    else eligible.push(c);
  }
  const { queued } = await enqueueAnalyses(ctx, eligible);
  const already = eligible.length - queued;
  if (already > 0) skipped.queued_already = already;
  return { ok: true, queued, skipped, typeErrors };
}

/**
 * «Volver a clasificar» varias grabaciones (selección múltiple). Cada una vuelve a la cola de clasificación, que aplica
 * primero las reglas sin IA y pregunta a la IA solo si ninguna decide. Lo que eligió una persona, lo analizado y lo
 * que está en curso no se toca (`reclassifyDecision`). A pedido de una persona, la IA también se usa en lo importado
 * del historial. El cambio de estado es condicional: dos clics a la vez dejan UN job (dedupe de la cola).
 */
export async function reclassifyCalls(input: { callIds: string[] }): Promise<{ ok: true; queued: number; skipped: Partial<Record<ReclassifySkip | "not_found", number>> } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const ids = [...new Set(Array.isArray(input.callIds) ? input.callIds : [])];
  if (ids.length === 0 || ids.length > RECLASSIFY_LIMIT || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return { ok: false, error: `Elegí entre 1 y ${RECLASSIFY_LIMIT} grabaciones` };
  }
  // Se lee con la sesión: solo entra lo que la persona puede ver.
  const { data, error } = await ctx.supabase
    .from("calls")
    .select("id, classification_source, analysis_status")
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .in("id", ids);
  if (error) return { ok: false, error: "No se pudieron leer las grabaciones. Probá de nuevo." };

  const service = await createServiceClient();
  const skipped: Partial<Record<ReclassifySkip | "not_found", number>> = {};
  const skip = (why: ReclassifySkip | "not_found") => (skipped[why] = (skipped[why] ?? 0) + 1);
  const found = new Set((data ?? []).map((c) => c.id));
  for (const id of ids) if (!found.has(id)) skip("not_found");
  let queued = 0;
  for (const c of data ?? []) {
    const decision = reclassifyDecision(c);
    if (decision.action === "skip") {
      skip(decision.why);
      continue;
    }
    const { data: moved } = await service
      .from("calls")
      .update({ analysis_status: "classifying", analysis_status_reason: null, analysis_error: null })
      .eq("id", c.id)
      .eq("workspace_id", ctx.workspace.id)
      .eq("analysis_status", c.analysis_status)
      .or("classification_source.is.null,classification_source.neq.human")
      .select("id");
    if (!moved || moved.length === 0) {
      skip("busy");
      continue;
    }
    try {
      await enqueueCallJob(service, "call_classify", c.id);
      queued += 1;
    } catch (err) {
      console.error("[llamadas] no pude encolar la clasificación:", err instanceof Error ? err.message : "error");
      // Que no quede colgada en «clasificando»: vuelve a por revisar con el motivo.
      await service.from("calls").update({ analysis_status: "needs_review", analysis_status_reason: "ai_error" }).eq("id", c.id).eq("analysis_status", "classifying");
      skip("busy");
    }
  }
  refresh("");
  return { ok: true, queued, skipped };
}

/** Marcar o sacar "no se presento". Es una marca: no cambia el area ni el tipo. */
export async function setCallNoShow(input: { callId: string; noShow: boolean }): Promise<CallEditResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!UUID.test(input.callId)) return { ok: false, error: "Los datos no son válidos" };

  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, title, duration_seconds, attendees, area_id, category_id, category_snapshot, no_show, analysis_status, transcript, imported_from_history")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: NOT_FOUND };
  if (call.no_show === input.noShow) return { ok: true };

  const service = await createServiceClient();
  const movable = ["needs_review", "pending", "not_applicable", "error"].includes(call.analysis_status);
  const profiles = await loadCallProfiles(service, ctx.workspace.id);
  const next = input.noShow || readCategorySnapshot(call.category_snapshot)
    ? statusAfterClassification(resolveProfile(profiles, { categoryId: call.category_id, areaId: call.area_id }), {
        transcript: call.transcript,
        title: call.title,
        duration_seconds: call.duration_seconds,
        attendees: call.attendees,
        noShow: input.noShow,
        importedFromHistory: call.imported_from_history,
      })
    : null;

  const { error } = await service
    .from("calls")
    .update({
      no_show: input.noShow,
      ...(movable && next ? { analysis_status: next.status, analysis_status_reason: next.reason, analysis_error: null } : {}),
      ...(movable && !next ? { analysis_status: "needs_review" as const, analysis_status_reason: "ai_off" } : {}),
    })
    .eq("id", call.id);
  if (error) {
    console.error("[llamadas] no pude cambiar la marca:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }
  if (movable && next?.enqueueAnalysis) await enqueueCallJob(service, "call_analyze", call.id);

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "call",
    entityId: call.id,
    action: "call.type_changed",
    changes: { no_show: { old: call.no_show, new: input.noShow } },
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
    .select("id, area_id, category_id, no_show, analysis_status, transcript")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: NOT_FOUND };
  if (call.analysis_status === "analyzed") return { ok: false, error: "Ya está analizada. Para volver a hacerlo, usá Regenerar." };

  const service = await createServiceClient();
  const profiles = await loadCallProfiles(service, ctx.workspace.id);
  const check = canAnalyze({
    status: call.analysis_status,
    hasArea: Boolean(call.area_id),
    noShow: call.no_show,
    hasProfile: Boolean(resolveProfile(profiles, { categoryId: call.category_id, areaId: call.area_id })),
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

  const { data: pending } = await ctx.supabase
    .from("calls")
    .select("id, area_id, category_id")
    .eq("workspace_id", ctx.workspace.id)
    .eq("analysis_status", "pending")
    .is("archived_at", null)
    .order("recorded_at", { ascending: false })
    .limit(ANALYZE_PENDING_LIMIT * 3);
  return enqueueAnalyses(ctx, pending ?? []);
}

/** "Analizar seleccionadas": lo mismo, con las que eligio la persona (la RLS decide cuales ve). */
export async function analyzeSelectedCalls(input: { callIds: string[] }): Promise<{ ok: true; queued: number; skipped: number } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const ids = [...new Set(Array.isArray(input.callIds) ? input.callIds : [])];
  if (ids.length === 0 || ids.length > ANALYZE_PENDING_LIMIT || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return { ok: false, error: `Elegí entre 1 y ${ANALYZE_PENDING_LIMIT} grabaciones` };
  }
  const { data } = await ctx.supabase
    .from("calls")
    .select("id, area_id, category_id, no_show, analysis_status, transcript")
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .in("id", ids);
  const eligible = (data ?? []).filter((c) => !c.no_show && c.analysis_status !== "analyzed" && c.analysis_status !== "analyzing" && c.analysis_status !== "classifying" && Array.isArray(c.transcript) && c.transcript.length > 0);
  const result = await enqueueAnalyses(ctx, eligible);
  return { ...result, skipped: ids.length - result.queued };
}

/** Encola de a una cada 30 segundos, solo las que tienen analizador, para no pegarle de golpe al proveedor. */
async function enqueueAnalyses(
  ctx: { workspace: { id: string }; user: { id: string } },
  calls: Array<{ id: string; area_id: string | null; category_id: string | null }>,
): Promise<{ ok: true; queued: number }> {
  const service = await createServiceClient();
  const profiles = await loadCallProfiles(service, ctx.workspace.id);
  const withProfile = calls.filter((c) => resolveProfile(profiles, { categoryId: c.category_id, areaId: c.area_id })).slice(0, ANALYZE_PENDING_LIMIT);
  const now = new Date();
  let queued = 0;
  for (const [i, call] of withProfile.entries()) {
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
    .select("id, category_snapshot, no_show, analysis_profile_id, analysis, rubric_snapshot, transcript, analysis_status, updated_at")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: NOT_FOUND };
  if (call.analysis_status !== "analyzed" || !call.analysis) return { ok: false, error: "La llamada todavía no tiene un análisis para corregir" };

  const applied = applySectionEdits(call.analysis, input.edits, {
    rubric: (call.rubric_snapshot ?? null) as never,
    // Un analisis de antes de los analizadores se recalcula con la rubrica filtrada por su tipo.
    callType: call.analysis_profile_id ? null : await derivedCallType(ctx.supabase, ctx.workspace.id, call),
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

// ── Causa de baja: corregirla o quitarla a mano ───────────────────────────

/** Pone (o quita, con `clave` vacía) la causa de baja de la reunión. Gana sobre la de la IA hasta el próximo análisis. */
export async function saveCallChurnCause(input: { callId: string; clave: string | null; motivo?: string | null }): Promise<CallEditResult> {
  const ctx = await getPermissionAction("calls.edit");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!UUID.test(input.callId)) return { ok: false, error: "Los datos no son válidos" };

  const service = await createServiceClient();
  const { data: ws } = await service.from("workspaces").select("ai_background_settings").eq("id", ctx.workspace.id).maybeSingle();
  const reasons = resolveCallTaskSettings(ws?.ai_background_settings).call_analysis.churn_reasons;
  const parsed = parseManualChurnCause({ clave: input.clave, motivo: input.motivo ?? null }, reasons);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { data: call } = await ctx.supabase
    .from("calls")
    .select("id, analysis, analysis_status, updated_at")
    .eq("id", input.callId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!call) return { ok: false, error: NOT_FOUND };
  if (call.analysis_status !== "analyzed" || !call.analysis || typeof call.analysis !== "object") return { ok: false, error: "La llamada todavía no tiene un análisis" };

  const before = readChurnCause(call.analysis);
  const next: Record<string, unknown> = { ...(call.analysis as Record<string, unknown>) };
  if (parsed.cause) next.causa_baja = parsed.cause;
  else delete next.causa_baja;
  const { data: updated, error } = await service
    .from("calls")
    .update({ analysis: next as unknown as Json, analysis_edited: true })
    .eq("id", call.id)
    // Si alguien guardó en el medio, no se pisa su cambio.
    .eq("updated_at", call.updated_at)
    .select("id");
  if (error) {
    console.error("[llamadas] no pude guardar la causa de baja:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }
  if (!updated || updated.length === 0) return { ok: false, error: "Otra persona modificó esta llamada mientras la editabas. Recargá y volvé a intentar." };

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "call",
    entityId: call.id,
    action: "call.churn_cause_set",
    changes: { causa_baja: { old: (before?.clave ?? null) as Json, new: (parsed.cause?.clave ?? null) as Json } },
    metadata: { label: churnReasonLabel(parsed.cause?.clave ?? null, reasons) },
    performedBy: ctx.user.id,
  });
  refresh(call.id);
  return { ok: true };
}
