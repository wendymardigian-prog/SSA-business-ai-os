"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { acceptProposal, discardProposal, mergeProposal } from "@/lib/calls/categories";
import { CATEGORY_GROUPS, slugKey, type CategoryGroup } from "@/lib/calls/rubric";
import { acceptTypeProposal, discardTypeProposal } from "@/lib/calls/type-proposals";
import { resolveCallTaskSettings } from "@/lib/calls/task-settings";
import { saveCallTaskSettings, type CallTaskSettingsResult } from "./call-task-settings";

/**
 * Decidir sobre las propuestas de la IA (F17, F27): aceptar, unir o descartar.
 *
 * Nada reescribe un analisis ni una llamada: la decision se guarda en la
 * configuracion de la tarea (`categories` / `custom_types`), por el mismo camino
 * que cualquier otro cambio de configuracion (`saveCallTaskSettings`: permiso
 * `calls.configure`, validacion, auditoria con el antes y el despues).
 */

const NOT_ALLOWED = "No tenés permiso para configurar las tareas de llamadas.";

async function currentSettings(workspaceId: string) {
  const service = await createServiceClient();
  const { data } = await service.from("workspaces").select("ai_background_settings").eq("id", workspaceId).maybeSingle();
  return resolveCallTaskSettings(data?.ai_background_settings);
}

export async function decideCategoryProposal(input: {
  group: string;
  key: string;
  decision: "accept" | "merge" | "discard";
  /** Aceptar: el nombre con el que queda. */
  name?: string;
  /** Unir: la clave de la categoria aceptada con la que se une. */
  targetKey?: string;
}): Promise<CallTaskSettingsResult> {
  const ctx = await getPermissionAction("calls.configure");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (!(CATEGORY_GROUPS as readonly string[]).includes(input.group)) return { ok: false, error: "Ese grupo de categorías no existe" };
  const group = input.group as CategoryGroup;
  const key = slugKey(input.key);
  if (!key || key === "otra") return { ok: false, error: "Esa propuesta no es válida" };

  const settings = (await currentSettings(ctx.workspace.id)).call_analysis;
  let categories = settings.categories;
  if (input.decision === "accept") {
    const name = input.name?.trim();
    if (!name) return { ok: false, error: "Ponele un nombre a la categoría" };
    categories = acceptProposal(categories, group, key, name.slice(0, 80));
  } else if (input.decision === "merge") {
    const merged = mergeProposal(categories, group, key, input.targetKey ?? "");
    if (!merged) return { ok: false, error: "Elegí una categoría aceptada para unirla" };
    categories = merged;
  } else if (input.decision === "discard") {
    categories = discardProposal(categories, group, key);
  } else {
    return { ok: false, error: "Esa decisión no existe" };
  }
  return saveCallTaskSettings("call_analysis", { ...settings, categories });
}

export async function decideTypeProposal(input: { name: string; decision: "accept" | "discard"; description?: string }): Promise<CallTaskSettingsResult> {
  const ctx = await getPermissionAction("calls.configure");
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  const name = input.name?.trim();
  if (!name || name.length > 60) return { ok: false, error: "El nombre del tipo no es válido" };

  const settings = (await currentSettings(ctx.workspace.id)).call_classification;
  const next =
    input.decision === "accept" ? acceptTypeProposal(settings, name, input.description?.trim().slice(0, 400) ?? "")
    : input.decision === "discard" ? discardTypeProposal(settings, name)
    : null;
  if (!next) return { ok: false, error: "Esa decisión no existe" };
  return saveCallTaskSettings("call_classification", next);
}
