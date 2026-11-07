"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { openAiRun, type AiRunHandle } from "@/lib/ai/run";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { resolveTaskModel } from "@/lib/ai-tasks/model";
import { aiSdkGenerate, type GenerateFn } from "@/lib/calls/ai-generate";
import { callDisplayLabel } from "@/lib/calls/catalog";
import { loadProfileInstructions } from "@/lib/calls/profile-instructions";
import { PROFILE_SHAPES, rubricForShape, validateProfileRubric, type ProfileShape } from "@/lib/calls/profiles";
import { loadCallProfiles } from "@/lib/calls/profiles-load";
import { MAX_TEST_CALLS, testCallAnalysis, validateTestRequest, type TestCallInput, type TestCallResult } from "@/lib/calls/prompt-test";
import { normalizeRubric } from "@/lib/calls/rubric";
import { resolveCallTaskSettings } from "@/lib/calls/task-settings";

/**
 * "Probar antes de guardar" (F26): corre un analizador con lo que tiene el editor, aunque no se
 * haya guardado, sobre 1 a 5 grabaciones, y compara con lo que hay. Nunca escribe en `calls` ni
 * en el analizador: solo se registran los runs (el costo cuenta).
 *
 * Permiso: `calls.configure`. Solo llamadas que quien prueba puede ver (cliente de la persona).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INSTRUCTIONS_CHARS = 32_000;

export type TestDraftResult = { ok: true; results: TestCallResult[] } | { ok: false; error: string };

export async function testCallDraft(input: {
  categoryId: string;
  shape: ProfileShape;
  callIds: string[];
  instructionsText?: string;
  rubricDraft: unknown;
}): Promise<TestDraftResult> {
  const ctx = await getPermissionAction("calls.configure");
  if (!ctx) return { ok: false, error: "No tenés permiso para probar el análisis" };
  if (typeof input.categoryId !== "string" || !UUID.test(input.categoryId) || !PROFILE_SHAPES.includes(input.shape)) return { ok: false, error: "Los datos no son válidos" };

  const ids = [...new Set((input.callIds ?? []).filter((id) => typeof id === "string"))];
  const invalid = validateTestRequest(ids);
  if (invalid) return { ok: false, error: invalid };
  if (ids.some((id) => !UUID.test(id))) return { ok: false, error: "Los datos no son válidos" };

  const { data: rows } = await ctx.supabase
    .from("calls")
    .select("id, title, call_type, category_snapshot, transcript, closer_score, lead_score, outcome, analysis")
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .in("id", ids)
    .limit(MAX_TEST_CALLS);
  const usable = (rows ?? []).filter((r) => Array.isArray(r.transcript) && r.transcript.length > 0);
  const calls: TestCallInput[] = usable.map((r) => ({
    id: r.id,
    title: r.title,
    call_type: r.call_type,
    transcript: r.transcript,
    current: { closer_score: r.closer_score, lead_score: r.lead_score, outcome: r.outcome, analysis: r.analysis },
  }));
  if (calls.length === 0) return { ok: false, error: "No encontré grabaciones con transcripción para probar" };

  const rubric = rubricForShape(normalizeRubric(input.shape === "general" ? { ...(input.rubricDraft as object), lead: [] } : input.rubricDraft), input.shape);
  const problems = validateProfileRubric(rubric, input.shape);
  if (problems.length > 0) return { ok: false, error: problems[0] };

  const service = await createServiceClient();
  const { data: ws } = await service.from("workspaces").select("ai_background_settings").eq("id", ctx.workspace.id).maybeSingle();
  const settings = resolveCallTaskSettings(ws?.ai_background_settings).call_analysis;

  let instructions: string;
  if (typeof input.instructionsText === "string" && input.instructionsText.trim()) {
    if (input.instructionsText.length > MAX_INSTRUCTIONS_CHARS) return { ok: false, error: `Las instrucciones no pueden superar ${MAX_INSTRUCTIONS_CHARS} caracteres.` };
    instructions = input.instructionsText.trim();
  } else {
    const saved = (await loadCallProfiles(service, ctx.workspace.id)).find((p) => p.categoryId === input.categoryId);
    instructions = (await loadProfileInstructions(service, ctx.workspace.id, { id: saved?.id ?? input.categoryId, shape: input.shape, activePromptVersion: saved?.activePromptVersion ?? null })).text;
  }

  const model = await resolveTaskModel(service, ctx.workspace.id, "call_analysis");
  if (!model.ok || !model.model) return { ok: false, error: model.message ?? "No hay un proveedor de IA conectado" };
  const base = aiSdkGenerate(model.model);

  // Un run por llamada: asi el costo de cada prueba queda a la vista en Corridas.
  let run: AiRunHandle | null = null;
  let usage: Parameters<AiRunHandle["setFinalUsage"]>[0];
  const generate: GenerateFn = async (args) => {
    const out = await base(args);
    usage = out.usage;
    return out;
  };

  const results = await testCallAnalysis(
    calls,
    {
      shape: input.shape,
      meetingLabelFor: (id) => {
        const row = usable.find((r) => r.id === id);
        return callDisplayLabel(row?.category_snapshot, row?.call_type ?? null);
      },
      rubric,
      categories: settings.categories,
      allowNewCategories: settings.allow_new_categories,
      companyContext: settings.company_context,
      instructions,
      generate,
    },
    {
      beforeEach: async (call) => {
        const gate = await withinWorkspaceBudget(service, ctx.workspace.id);
        if (!gate.allowed) return { allowed: false, message: gate.message ?? "Se alcanzó el tope de gasto de IA" };
        usage = undefined;
        run = await openAiRun(service, { workspaceId: ctx.workspace.id, source: "call_prompt_test", trigger: "manual", threadId: call.id });
        if (model.provider && model.modelId) run.setModel(model.provider, model.modelId);
        return { allowed: true };
      },
      afterEach: async (_call, result) => {
        if (!run) return;
        run.setFinalUsage(usage);
        await run.close(result.ok ? { status: "responded" } : { status: "error", statusDetail: "generation_failed", error: (result.error ?? "").slice(0, 300) });
        run = null;
      },
    },
  );
  return { ok: true, results };
}
