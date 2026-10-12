"use server";

import { getMemberAction } from "@/lib/auth/guards";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { getTrigger } from "@/lib/flow-engine/registry";
import type { ConditionFieldSpec } from "@/lib/flow-engine/condition-eval";
import type { ConditionCatalogInputs } from "@/lib/automations/condition-catalog-inputs";

/**
 * Lo que el servidor sabe y el navegador no, para armar "Condiciones" (canvas y
 * editor de pasos): que campos aporta el disparador, que campos personalizados,
 * tags y secuencias hay.
 *
 * `variableSchema` de los disparadores es asincrono y lee la base (las preguntas
 * de los formularios), asi que corre ACA. Todo con el cliente del usuario (la
 * RLS decide que ve) y el workspace sale de la sesion, nunca del pedido. Lo que
 * se devuelve (nombres de campos, tags, secuencias) ya lo ve esa persona en las
 * mismas pantallas de edicion.
 *
 * El navegador despues le suma lo que depende del grafo que esta editando (los
 * pasos que quedan ANTES de cada nodo) con `availableConditionFields`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConditionCatalogResult = { ok: true; inputs: ConditionCatalogInputs } | { ok: false; error: string };

export async function getConditionCatalogInputs(input: {
  flowId: string;
  /** Los datos del nodo disparador tal como estan en la pantalla (puede haber cambios sin guardar). Sin esto, los guardados. */
  triggerData?: Record<string, unknown>;
}): Promise<ConditionCatalogResult> {
  const ctx = await getMemberAction();
  if (!ctx || !(ctx.can("flows.view") || ctx.can("forms.view") || ctx.can("scheduling.use"))) {
    return { ok: false, error: "No tenés permiso para ver las automatizaciones." };
  }
  if (!UUID.test(input.flowId)) return { ok: false, error: "No encontré esa automatización." };

  const { supabase, workspace } = ctx;

  const { data: flow } = await supabase.from("flows").select("id, nodes").eq("id", input.flowId).eq("workspace_id", workspace.id).maybeSingle();
  if (!flow) return { ok: false, error: "No encontré esa automatización." };

  // El disparador de la pantalla si lo mandaron; si no, el guardado.
  const stored = (Array.isArray(flow.nodes) ? (flow.nodes as Array<Record<string, unknown>>) : []).find((n) => n?.type === "trigger");
  const triggerData = input.triggerData && typeof input.triggerData === "object" ? input.triggerData : ((stored?.data ?? {}) as Record<string, unknown>);

  let triggerSchema: ConditionFieldSpec[] = [];
  try {
    // La misma conversion que hace el servidor al publicar: de los datos del nodo a (tipo, config).
    const [desired] = buildDesiredTriggers([{ type: "trigger", data: triggerData }], input.flowId);
    const definition = desired ? getTrigger(desired.type) : undefined;
    if (desired && definition?.variableSchema) {
      triggerSchema = await definition.variableSchema((desired.config ?? {}) as Record<string, unknown>, { supabase, workspaceId: workspace.id });
    }
  } catch (error) {
    // Sin el esquema del disparador igual se pueden comparar los datos del contacto.
    console.error("[flow-conditions] no pude leer los campos del disparador:", error instanceof Error ? error.message : error);
  }

  const [customFields, tags, sequences] = await Promise.all([
    supabase.from("custom_field_definitions").select("slug, name, type").eq("workspace_id", workspace.id).is("deleted_at", null).order("name"),
    supabase.from("tags").select("name").eq("workspace_id", workspace.id).order("name"),
    supabase.from("sequences").select("id, name").eq("workspace_id", workspace.id).order("name"),
  ]);

  return {
    ok: true,
    inputs: {
      triggerSchema,
      customFields: (customFields.data ?? []).map((f) => ({ slug: f.slug, name: f.name, type: f.type })),
      tags: (tags.data ?? []).map((t) => ({ name: t.name })),
      sequences: (sequences.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    },
  };
}
