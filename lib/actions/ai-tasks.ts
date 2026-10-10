"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { getAiTask, type AiTaskId } from "@/lib/ai-tasks/catalog";
import { loadTaskInstructions, taskIsVersioned, type VersionedTask } from "@/lib/ai-tasks/store";
import { listConnectedAiProviders } from "@/lib/ai/provider";
import { parseTaskModels } from "@/lib/ai-tasks/model";
import type { Json } from "@/lib/types/database";

/**
 * Instrucciones versionadas de las tareas de IA (Bloque Agentes IA). Mismo
 * patron que `saveSystemPrompt` / `restorePromptVersion` de un agente
 * (lib/actions/agents.ts): guardar crea una version nueva y la activa; volver
 * a una anterior la activa sin reescribir el historial. Solo Owner/Admin
 * (00137 lo repite en la RLS).
 */

const TASKS_PATH = "/dashboard/agents/tareas";
const NOT_ADMIN = "Solo Owner y Admin pueden editar las instrucciones de una tarea.";
/** Mismo tope que el prompt de un agente (lib/agent/validate.ts). */
const MAX_INSTRUCTIONS_CHARS = 32_000;

export type AiTaskActionResult = { ok: true } | { ok: false; error: string };

function revalidate(task: string) {
  revalidatePath("/dashboard/agents");
  revalidatePath(`${TASKS_PATH}/${task}`);
}

/** Guardar crea una version nueva y la activa. */
export async function saveTaskInstructions(taskId: string, rawInstructions: string, rawNote?: string): Promise<AiTaskActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;

  const task = getAiTask(taskId);
  if (!task || !taskIsVersioned(task.id)) return { ok: false, error: "Esa tarea no tiene instrucciones editables." };

  const instructions = typeof rawInstructions === "string" ? rawInstructions.trim() : "";
  if (!instructions) return { ok: false, error: "Las instrucciones no pueden quedar vacías." };
  if (instructions.length > MAX_INSTRUCTIONS_CHARS) {
    return { ok: false, error: `Las instrucciones no pueden superar ${MAX_INSTRUCTIONS_CHARS} caracteres.` };
  }
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 200) || null : null;

  const { data: last } = await supabase
    .from("ai_task_prompt_versions")
    .select("version")
    .eq("workspace_id", workspace.id)
    .eq("task", task.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (last?.version ?? 0) + 1;

  const { error: versionError } = await supabase.from("ai_task_prompt_versions").insert({
    workspace_id: workspace.id,
    task: task.id as VersionedTask,
    version,
    instructions,
    note,
    created_by: user.id,
  });
  if (versionError) {
    console.error(`[ai-tasks] no pude guardar la version de ${task.id}:`, versionError.message);
    return {
      ok: false,
      error: versionError.code === "23505" ? "Otra persona guardó al mismo tiempo. Recargá y probá de nuevo." : "No pude guardar las instrucciones.",
    };
  }

  const current = ((workspace as unknown as { ai_task_prompt_active?: Json }).ai_task_prompt_active ?? {}) as Record<string, number>;
  const active = { ...current, [task.id]: version };
  const { error: activateError } = await supabase.from("workspaces").update({ ai_task_prompt_active: active as Json }).eq("id", workspace.id);
  if (activateError) {
    console.error(`[ai-tasks] no pude activar la version de ${task.id}:`, activateError.message);
    return { ok: false, error: "Se guardó la versión pero no pude activarla. Probá volver a ella desde el historial." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "ai_task",
    entityId: task.id,
    action: "prompt_version",
    changes: { active_version: { old: null, new: version } },
    metadata: { note, chars: instructions.length },
    performedBy: user.id,
  });

  revalidate(task.id);
  return { ok: true };
}

/** Volver a una version anterior: la activa pasa a ser esa, sin reescribir el historial. */
export async function restoreTaskInstructions(taskId: string, version: number | null): Promise<AiTaskActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: NOT_ADMIN };
  const { workspace, supabase, user } = ctx;

  const task = getAiTask(taskId);
  if (!task || !taskIsVersioned(task.id)) return { ok: false, error: "Esa tarea no tiene instrucciones editables." };

  // version null = "volver al texto del sistema": sacar la entrada, no apuntar a la 0.
  if (version !== null) {
    if (!Number.isInteger(version) || version < 1) return { ok: false, error: "Versión inválida." };
    const { data: target } = await supabase
      .from("ai_task_prompt_versions")
      .select("version")
      .eq("workspace_id", workspace.id)
      .eq("task", task.id)
      .eq("version", version)
      .maybeSingle();
    if (!target) return { ok: false, error: "Esa versión no existe." };
  }

  const current = ((workspace as unknown as { ai_task_prompt_active?: Json }).ai_task_prompt_active ?? {}) as Record<string, number>;
  const next = { ...current };
  if (version === null) delete next[task.id];
  else next[task.id] = version;

  const { error } = await supabase.from("workspaces").update({ ai_task_prompt_active: next as Json }).eq("id", workspace.id);
  if (error) {
    console.error(`[ai-tasks] no pude restaurar la version de ${task.id}:`, error.message);
    return { ok: false, error: "No pude volver a esa versión." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "ai_task",
    entityId: task.id,
    action: "prompt_version",
    changes: { active_version: { old: current[task.id] ?? null, new: version } },
    metadata: { restored: true },
    performedBy: user.id,
  });

  revalidate(task.id);
  return { ok: true };
}

/** Mas largo que cualquier identificador de modelo real: es un tope contra basura. */
const MAX_MODEL_ID_CHARS = 200;

/**
 * El modelo de una tarea (00138). `provider` y `model` en null = "usar el modelo
 * del negocio" (se saca la entrada). Con valores, el proveedor tiene que estar
 * conectado y generar texto: guardar uno que no corre dejaria la tarea fallando
 * hasta que alguien lo note.
 */
export async function saveTaskModel(taskId: string, provider: string | null, model: string | null): Promise<AiTaskActionResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden elegir el modelo de una tarea." };
  const { workspace, supabase, user } = ctx;

  const task = getAiTask(taskId);
  if (!task || !task.hasModelPicker) return { ok: false, error: "Esa tarea no permite elegir el modelo." };

  const current = parseTaskModels((workspace as unknown as { ai_task_models?: Json }).ai_task_models);
  const next = { ...current };

  const cleanProvider = typeof provider === "string" ? provider.trim() : "";
  const cleanModel = typeof model === "string" ? model.trim() : "";

  if (!cleanProvider && !cleanModel) {
    delete next[task.id];
  } else {
    if (!cleanProvider || !cleanModel) return { ok: false, error: "Elegí un proveedor y un modelo." };
    if (cleanModel.length > MAX_MODEL_ID_CHARS) return { ok: false, error: "El nombre del modelo es demasiado largo." };
    const connected = await listConnectedAiProviders(workspace.id);
    if (!connected.some((p) => p.provider === cleanProvider)) {
      return { ok: false, error: "Ese proveedor no está conectado. Conectalo en Ajustes → Integraciones." };
    }
    next[task.id] = { provider: cleanProvider, model: cleanModel };
  }

  const { error } = await supabase.from("workspaces").update({ ai_task_models: next as unknown as Json }).eq("id", workspace.id);
  if (error) {
    console.error(`[ai-tasks] no pude guardar el modelo de ${task.id}:`, error.message);
    return { ok: false, error: "No pude guardar el modelo." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "ai_task",
    entityId: task.id,
    action: "model_changed",
    changes: { model: { old: current[task.id] ? `${current[task.id].provider}/${current[task.id].model}` : null, new: next[task.id] ? `${next[task.id].provider}/${next[task.id].model}` : null } },
    metadata: {},
    performedBy: user.id,
  });

  revalidate(task.id);
  return { ok: true };
}

/** Lo que muestra el editor al abrir la pestaña: lo activo, mas el texto del sistema para comparar. */
export async function loadTaskInstructionsForEdit(taskId: string) {
  const ctx = await getAdminContext();
  if (!ctx) return null;
  const task = getAiTask(taskId);
  if (!task || !taskIsVersioned(task.id)) return null;
  return loadTaskInstructions(ctx.supabase, ctx.workspace.id, task.id);
}
