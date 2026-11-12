"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { loadProfileInstructions } from "@/lib/calls/profile-instructions";
import { PROFILE_MODES, PROFILE_SHAPES, parseProfile, parseProfileRules, rubricForShape, validateProfileRubric, type ProfileMode, type ProfileShape } from "@/lib/calls/profiles";
import { normalizeRubric, rubricScoringChanged, type Rubric } from "@/lib/calls/rubric";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";
import type { Json } from "@/lib/types/database";

/**
 * Un analizador por tipo de reunion (00303). Escribe solo el servidor, despues de
 * `calls.configure`, y siempre sobre el workspace de la SESION. Guardar es una sola accion:
 * configuracion, rubrica e instrucciones, asi la pantalla tiene un unico boton.
 */

const NOT_ALLOWED = "No tenés permiso para configurar el análisis de grabaciones";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INSTRUCTIONS_CHARS = 32_000;
const PROFILE_COLUMNS = "id, workspace_id, category_id, shape, mode, rules, rubric, auto_summary, auto_memory, auto_knowledge, active_prompt_version";

export type CallProfileResult = { ok: true; profileId: string; rubricVersion: number } | { ok: false; error: string };
export type CallProfileSimpleResult = { ok: true } | { ok: false; error: string };

export interface SaveCallProfileInput {
  categoryId: string;
  shape: ProfileShape;
  mode: ProfileMode;
  rules: unknown;
  rubric: unknown;
  autoSummary: boolean;
  autoMemory: boolean;
  autoKnowledge: boolean;
  /** El texto del editor. Si no cambio, no se crea una version. */
  instructions?: string;
  /** Servicios A4 (F142, F144): «Proponer acciones» y «Proponer siempre un mensaje». Sin esto, no se toca. */
  proposals?: { enabled: boolean; client_message: boolean };
}

function refresh(): void {
  revalidatePath("/dashboard/agents/tareas/call_analysis");
  revalidatePath("/dashboard/llamadas");
}

export async function saveCallProfile(input: SaveCallProfileInput): Promise<CallProfileResult> {
  const ctx = await getPermissionAction("calls.configure");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (typeof input?.categoryId !== "string" || !UUID.test(input.categoryId)) return { ok: false, error: "Elegí un área o un tipo." };
  if (!PROFILE_SHAPES.includes(input.shape) || !PROFILE_MODES.includes(input.mode)) return { ok: false, error: "Los datos no son válidos." };

  const instructions = typeof input.instructions === "string" ? input.instructions.trim() : null;
  if (instructions !== null && !instructions) return { ok: false, error: "Las instrucciones no pueden quedar vacías." };
  if (instructions && instructions.length > MAX_INSTRUCTIONS_CHARS) return { ok: false, error: `Las instrucciones no pueden superar ${MAX_INSTRUCTIONS_CHARS} caracteres.` };

  const service = await createServiceClient();
  const categories = (await listCategories(service, ctx.workspace.id)).map(toCategoryRow);
  if (!categories.some((c) => c.id === input.categoryId && !c.archived_at)) return { ok: false, error: "Esa área o ese tipo ya no existe." };

  const shaped: Rubric = rubricForShape(normalizeForShape(input.rubric, input.shape), input.shape);
  const problems = validateProfileRubric(shaped, input.shape);
  if (problems.length > 0) return { ok: false, error: problems[0] };

  const { data: previous } = await service
    .from("call_analysis_profiles")
    .select(PROFILE_COLUMNS)
    .eq("workspace_id", ctx.workspace.id)
    .eq("category_id", input.categoryId)
    .is("archived_at", null)
    .maybeSingle();
  const before = previous ? parseProfile(previous as unknown as Record<string, unknown>) : null;

  // La version de la rubrica solo sube si cambia algo que mueve los puntajes.
  const version = before ? (rubricScoringChanged(before.rubric, shaped) || before.shape !== input.shape ? before.rubric.version + 1 : before.rubric.version) : 1;
  const rubric: Rubric = { ...shaped, version };
  const row = {
    shape: input.shape,
    mode: input.mode,
    rules: parseProfileRules(input.rules) as unknown as Json,
    rubric: rubric as unknown as Json,
    auto_summary: input.autoSummary === true,
    auto_memory: input.autoMemory === true,
    auto_knowledge: input.autoKnowledge === true,
    // Solo el formato general propone; el mensaje necesita las propuestas prendidas.
    ...(input.proposals
      ? { proposals: { enabled: input.shape === "general" && input.proposals.enabled === true, client_message: input.shape === "general" && input.proposals.enabled === true && input.proposals.client_message === true } as unknown as Json }
      : {}),
    updated_by: ctx.user.id,
    updated_at: new Date().toISOString(),
  };

  const saved = before
    ? await service.from("call_analysis_profiles").update(row).eq("id", before.id).eq("workspace_id", ctx.workspace.id).select("id").single()
    : await service
        .from("call_analysis_profiles")
        .insert({ ...row, workspace_id: ctx.workspace.id, category_id: input.categoryId, created_by: ctx.user.id })
        .select("id")
        .single();
  if (saved.error || !saved.data) {
    console.error("[llamadas] no pude guardar el analizador:", saved.error?.message ?? "sin fila");
    return { ok: false, error: saved.error?.code === "23505" ? "Otra persona creó este analizador recién. Recargá y probá de nuevo." : "No pude guardar el analizador." };
  }
  const profileId = saved.data.id;

  let promptVersion: number | null = null;
  if (instructions) {
    const current = await loadProfileInstructions(service, ctx.workspace.id, { id: profileId, shape: input.shape, activePromptVersion: before?.activePromptVersion ?? null });
    if (current.text.trim() !== instructions) {
      const created = await createVersion(service, ctx.workspace.id, profileId, instructions, ctx.user.id);
      if (!created.ok) return created;
      promptVersion = created.version;
    }
  }

  // Lo que esperaba este analizador queda para analizar a mano: nada se gasta por haberlo configurado.
  if (!before) {
    const { error: pendingError } = await service
      .from("calls")
      .update({ analysis_status: "pending", analysis_status_reason: "manual" })
      .eq("workspace_id", ctx.workspace.id)
      .eq("analysis_status", "not_applicable")
      .eq("analysis_status_reason", "no_profile")
      .or(`category_id.eq.${input.categoryId},area_id.eq.${input.categoryId}`);
    if (pendingError) console.error("[llamadas] no pude pasar a pendientes las grabaciones de ese tipo:", pendingError.message);
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "ai_task",
    entityId: profileId,
    action: before ? "update" : "create",
    changes: {
      mode: { old: before?.mode ?? null, new: input.mode },
      shape: { old: before?.shape ?? null, new: input.shape },
      rubric: { old: (before?.rubric ?? null) as unknown as Json, new: rubric as unknown as Json },
    },
    metadata: { task: "call_analysis", category_id: input.categoryId, ...(promptVersion ? { prompt_version: promptVersion } : {}) },
    performedBy: ctx.user.id,
  });

  refresh();
  return { ok: true, profileId, rubricVersion: version };
}

/** El formato general no tiene lead: `normalizeRubric` lo completaria con el de ventas. */
function normalizeForShape(raw: unknown, shape: ProfileShape): Rubric {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (shape === "sales") return normalizeRubric(value);
  return Array.isArray(value.closer) && value.closer.length > 0 ? normalizeRubric({ ...value, lead: [] }) : { version: 1, closer: [], lead: [] };
}

async function createVersion(
  service: Awaited<ReturnType<typeof createServiceClient>>,
  workspaceId: string,
  profileId: string,
  instructions: string,
  userId: string,
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const { data: last } = await service
    .from("ai_task_prompt_versions")
    .select("version")
    .eq("workspace_id", workspaceId)
    .eq("task", "call_analysis")
    .eq("variant", profileId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const { error } = await service
    .from("ai_task_prompt_versions")
    .insert({ workspace_id: workspaceId, task: "call_analysis", variant: profileId, version, instructions, created_by: userId });
  if (error) {
    console.error("[llamadas] no pude guardar la version de las instrucciones:", error.message);
    return { ok: false, error: error.code === "23505" ? "Otra persona guardó al mismo tiempo. Recargá y probá de nuevo." : "Se guardó el analizador, pero no pude guardar las instrucciones." };
  }
  const { error: activateError } = await service
    .from("call_analysis_profiles")
    .update({ active_prompt_version: version })
    .eq("id", profileId)
    .eq("workspace_id", workspaceId);
  if (activateError) {
    console.error("[llamadas] no pude activar la version de las instrucciones:", activateError.message);
    return { ok: false, error: "Se guardaron las instrucciones, pero no pude activarlas. Probá volver a esa versión." };
  }
  return { ok: true, version };
}

/** Volver a una version anterior, o al texto por defecto con `version: null`. No reescribe el historial. */
export async function restoreCallProfileInstructions(input: { profileId: string; version: number | null }): Promise<CallProfileSimpleResult> {
  const ctx = await getPermissionAction("calls.configure");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (typeof input?.profileId !== "string" || !UUID.test(input.profileId)) return { ok: false, error: "Los datos no son válidos." };
  const service = await createServiceClient();

  const { data: profile } = await service
    .from("call_analysis_profiles")
    .select("id, active_prompt_version")
    .eq("id", input.profileId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Ese analizador ya no existe." };

  if (input.version !== null) {
    const { data: exists } = await service
      .from("ai_task_prompt_versions")
      .select("version")
      .eq("workspace_id", ctx.workspace.id)
      .eq("task", "call_analysis")
      .eq("variant", profile.id)
      .eq("version", input.version)
      .maybeSingle();
    if (!exists) return { ok: false, error: "Esa versión ya no existe." };
  }

  const { error } = await service.from("call_analysis_profiles").update({ active_prompt_version: input.version, updated_by: ctx.user.id }).eq("id", profile.id).eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[llamadas] no pude cambiar la version de las instrucciones:", error.message);
    return { ok: false, error: "No pude cambiar la versión." };
  }
  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "ai_task",
    entityId: profile.id,
    action: "prompt_version",
    changes: { active_version: { old: profile.active_prompt_version, new: input.version } },
    metadata: { task: "call_analysis", restored: true },
    performedBy: ctx.user.id,
  });
  refresh();
  return { ok: true };
}

/** Sacar el analizador de un tipo: sus grabaciones dejan de analizarse. Se archiva, no se borra. */
export async function archiveCallProfile(input: { profileId: string }): Promise<CallProfileSimpleResult> {
  const ctx = await getPermissionAction("calls.configure");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (typeof input?.profileId !== "string" || !UUID.test(input.profileId)) return { ok: false, error: "Los datos no son válidos." };
  const service = await createServiceClient();
  const { data, error } = await service
    .from("call_analysis_profiles")
    .update({ archived_at: new Date().toISOString(), updated_by: ctx.user.id })
    .eq("id", input.profileId)
    .eq("workspace_id", ctx.workspace.id)
    .is("archived_at", null)
    .select("id");
  if (error) {
    console.error("[llamadas] no pude archivar el analizador:", error.message);
    return { ok: false, error: "No pude quitar el analizador." };
  }
  if (!data?.length) return { ok: false, error: "Ese analizador ya no existe." };
  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "ai_task",
    entityId: input.profileId,
    action: "update",
    changes: { archived_at: { old: null, new: new Date().toISOString() } },
    metadata: { task: "call_analysis", archived: true },
    performedBy: ctx.user.id,
  });
  refresh();
  return { ok: true };
}
