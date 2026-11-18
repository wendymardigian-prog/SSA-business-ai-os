import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getExactWorkspaceModel, getWorkspaceModel, type AiModelResult } from "@/lib/ai/provider";
import { getProvider, isTextProvider } from "@/lib/integrations/providers";
import { getAiTask, type AiTaskId } from "./catalog";

type Db = SupabaseClient<Database>;

/**
 * El modelo elegido para una tarea de IA (00138: `workspaces.ai_task_models`).
 *
 * Una tarea sin eleccion usa el modelo por defecto del negocio, igual que
 * antes, salvo que el catalogo diga `defaultModel: "cheapest"`: entonces usa
 * el mas barato con precio cargado entre los proveedores conectados. Con eleccion, se usa ESE proveedor y ESE modelo y, si el proveedor ya
 * no esta conectado, se falla con un mensaje claro: nunca se cambia de modelo
 * en silencio (mismo criterio que el agente de chat, `getExactWorkspaceModel`):
 * quien mira la pantalla tiene que poder confiar en que el modelo que ve es el
 * que corre.
 */

export interface TaskModelChoice {
  provider: string;
  model: string;
}

/** Lo guardado, sin confiar: una entrada rota se ignora en vez de romper la tarea. */
export function parseTaskModels(raw: unknown): Record<string, TaskModelChoice> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, TaskModelChoice> = {};
  for (const [task, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const { provider, model } = value as Record<string, unknown>;
    if (typeof provider === "string" && provider.trim() && typeof model === "string" && model.trim()) {
      out[task] = { provider: provider.trim(), model: model.trim() };
    }
  }
  return out;
}

export function taskModelOf(raw: unknown, task: AiTaskId): TaskModelChoice | null {
  return parseTaskModels(raw)[task] ?? null;
}

/** El modelo elegido para la tarea, o null si usa el del negocio. Nunca lanza. */
export async function loadTaskModel(service: Db, workspaceId: string, task: AiTaskId): Promise<TaskModelChoice | null> {
  try {
    const { data, error } = await service.from("workspaces").select("ai_task_models").eq("id", workspaceId).maybeSingle();
    if (error || !data) return null;
    return taskModelOf(data.ai_task_models, task);
  } catch (err) {
    console.error(`[ai-tasks] no pude leer el modelo de ${task}, uso el del negocio:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Arma el modelo de la tarea: el elegido (estricto) o el del negocio.
 *
 * Si la lectura de lo elegido falla (red, columna que todavia no llego a este
 * ambiente) se usa el del negocio: la tarea sigue corriendo como hoy.
 */
export async function resolveTaskModel(
  service: Db,
  workspaceId: string,
  task: AiTaskId,
): Promise<AiModelResult & { chosen: boolean }> {
  const choice = await loadTaskModel(service, workspaceId, task);
  if (choice) {
    const exact = await getExactWorkspaceModel(workspaceId, {
      provider: choice.provider,
      modelId: choice.model,
      supabase: service,
    });
    return { ...exact, chosen: true };
  }
  if (getAiTask(task)?.defaultModel === "cheapest") {
    const cheapest = await cheapestConfiguredModel(service, workspaceId).catch(() => null);
    if (cheapest) {
      const resolved = await getWorkspaceModel(workspaceId, { ...cheapest, supabase: service });
      if (resolved.ok && resolved.model) return { ...resolved, chosen: false };
    }
  }
  const fallback = await getWorkspaceModel(workspaceId, { supabase: service });
  return { ...fallback, chosen: false };
}

/**
 * El modelo de texto más barato entre los proveedores conectados, según
 * `model_pricing`.
 *
 * `getWorkspaceModel` sin preferencia cae al `default_model` del catálogo de
 * proveedores, que para Anthropic es Sonnet: el doble de precio por token que
 * Haiku, para tareas cortas que no lo necesitan. El criterio es la suma de
 * entrada y salida, que es lo que se paga. Sin proveedores o sin precios: null.
 */
export async function cheapestConfiguredModel(
  supabase: Db,
  workspaceId: string,
): Promise<{ preferredProvider: string; modelId: string } | null> {
  const { data: configs } = await supabase
    .from("integration_configs")
    .select("provider")
    .eq("workspace_id", workspaceId)
    .eq("type", "ai_provider")
    .eq("is_active", true);

  const textProviders = (configs ?? [])
    .map((c) => c.provider as string)
    .filter((id) => {
      const definition = getProvider(id);
      return definition ? isTextProvider(definition) : false;
    });
  if (textProviders.length === 0) return null;

  const { data: prices, error } = await supabase
    .from("model_pricing")
    .select("provider, model, input_per_mtok, output_per_mtok")
    .eq("workspace_id", workspaceId)
    .in("provider", textProviders)
    .lte("valid_from", new Date().toISOString());
  if (error || !prices || prices.length === 0) return null;

  let best: { preferredProvider: string; modelId: string; cost: number } | null = null;
  for (const row of prices) {
    const cost = Number(row.input_per_mtok ?? 0) + Number(row.output_per_mtok ?? 0);
    if (!Number.isFinite(cost) || cost <= 0) continue;
    if (!best || cost < best.cost) {
      best = { preferredProvider: row.provider as string, modelId: row.model as string, cost };
    }
  }
  return best ? { preferredProvider: best.preferredProvider, modelId: best.modelId } : null;
}
