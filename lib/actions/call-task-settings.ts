"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { normalizeRubric, rubricScoringChanged } from "@/lib/calls/rubric";
import { isCallTaskKey, validateCallTaskSettings } from "@/lib/calls/task-settings";
import type { Json } from "@/lib/types/database";

/**
 * Guardar la configuracion de una tarea de Llamadas (reglas y umbral del
 * clasificador; modo, rubrica, categorias y contexto del analisis).
 *
 * Quien puede: `calls.configure` (no "ser Admin"). Se escribe con la funcion de
 * la base (`set_ai_background_task_settings`, solo service_role): cambia UNA
 * clave de `ai_background_settings` y deja las demas como estaban, incluidas las
 * tareas en segundo plano. La auditoria cuelga del workspace con el antes y el
 * despues de esa clave (`audit_log.entity_id` es un uuid y la tarea es texto).
 */

export type CallTaskSettingsResult = { ok: true; rubricVersion?: number } | { ok: false; error: string };

const NOT_ALLOWED = "No tenés permiso para configurar las tareas de llamadas.";

export async function saveCallTaskSettings(task: string, input: unknown): Promise<CallTaskSettingsResult> {
  const ctx = await getPermissionAction("calls.configure");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!isCallTaskKey(task)) return { ok: false, error: "Esa tarea no tiene configuración." };

  const service = await createServiceClient();

  const { data: current } = await service.from("workspaces").select("ai_background_settings").eq("id", ctx.workspace.id).maybeSingle();
  const stored = (current?.ai_background_settings ?? {}) as Record<string, unknown>;

  const validated = validateCallTaskSettings(task, input, stored[task]);
  if (!validated.ok) return { ok: false, error: validated.error };

  const { data: previous, error } = await service.rpc("set_ai_background_task_settings", {
    p_workspace_id: ctx.workspace.id,
    p_task: task,
    p_value: validated.value as unknown as Json,
  });
  if (error) {
    console.error("[llamadas] no pude guardar la configuración de la tarea:", error.message);
    return { ok: false, error: "No pude guardar el cambio." };
  }

  const rubricVersion = validated.task === "call_analysis" ? validated.value.rubric.version : undefined;
  const scoringChanged =
    validated.task === "call_analysis" && rubricScoringChanged(normalizeRubric((previous as { rubric?: unknown } | null)?.rubric), validated.value.rubric);

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "update",
    changes: { [`ai_background_settings.${task}`]: { old: (previous ?? null) as Json, new: validated.value as unknown as Json } },
    metadata: {
      task,
      ...(rubricVersion !== undefined ? { rubric_version: rubricVersion } : {}),
      ...(scoringChanged ? { rubric_scoring_changed: true } : {}),
    },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/agents");
  revalidatePath(`/dashboard/agents/tareas/${task}`);
  revalidatePath("/dashboard/llamadas");
  return { ok: true, ...(rubricVersion !== undefined ? { rubricVersion } : {}) };
}
