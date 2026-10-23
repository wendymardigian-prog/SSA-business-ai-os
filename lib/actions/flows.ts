"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import type { Json } from "@/lib/types/database";
import {
  categorySuggestions,
  MAX_FLOW_NAME_LENGTH,
  normalizeCategories,
  normalizeDescription,
} from "@/lib/flows/categories";

/**
 * Guardar una automatizacion desde el lienzo y editar sus detalles (auditoria de automatizaciones, oct 2026).
 *
 * Antes el lienzo escribia `flows` directo desde el navegador: se saltaba toda validacion y, en una automatizacion
 * PUBLICADA, el cambio corria al instante (el motor lee `flows.nodes`) aunque el disparador siguiera siendo el viejo
 * hasta republicar. Ahora:
 *  - un BORRADOR guarda en `nodes`/`edges`, como siempre (no corre);
 *  - una PUBLICADA guarda en `draft_nodes`/`draft_edges` (00254): lo que corre no cambia hasta "Publicar cambios".
 *
 * Todo con `flows.edit` y el workspace de la sesion (la RLS de `flows` repite el permiso).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_PERMISSION = "No tenés permiso para editar automatizaciones.";
const NOT_FOUND = "No encontré esa automatización.";
/** Un grafo mas grande que esto no es un flujo, es un error (o un abuso). */
const MAX_GRAPH_BYTES = 1_000_000;

export type FlowActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_FLOW_NAME_LENGTH).trim();
  return name || null;
}

export async function saveFlowDraft(input: {
  flowId: string;
  name?: string;
  nodes: unknown[];
  edges: unknown[];
  viewport?: unknown;
}): Promise<FlowActionResult<{ unpublishedChanges: boolean; savedAt: string }>> {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(input.flowId)) return { ok: false, error: NOT_FOUND };
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) return { ok: false, error: "Los pasos no tienen la forma esperada." };
  if (JSON.stringify({ n: input.nodes, e: input.edges }).length > MAX_GRAPH_BYTES) {
    return { ok: false, error: "La automatización es demasiado grande para guardarla." };
  }

  const { data: flow, error: readError } = await ctx.supabase
    .from("flows")
    .select("id, status")
    .eq("id", input.flowId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (readError) return { ok: false, error: "No pude leer la automatización. Probá de nuevo." };
  if (!flow) return { ok: false, error: NOT_FOUND };

  const savedAt = new Date().toISOString();
  const published = flow.status === "published";
  const name = input.name === undefined ? null : cleanName(input.name);
  const update = {
    ...(name ? { name } : {}),
    ...(input.viewport !== undefined ? { viewport: input.viewport as Json } : {}),
    ...(published
      ? { draft_nodes: input.nodes as Json, draft_edges: input.edges as Json, draft_updated_at: savedAt }
      : { nodes: input.nodes as Json, edges: input.edges as Json }),
  };
  const { error } = await ctx.supabase.from("flows").update(update).eq("id", input.flowId).eq("workspace_id", ctx.workspace.id);
  if (error) {
    console.error("[flows] no pude guardar la automatizacion:", error.message);
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
  revalidatePath("/dashboard/flows");
  return { ok: true, unpublishedChanges: published, savedAt };
}

/** Descarta los cambios sin publicar: vuelve a lo que corre. Devuelve los pasos publicados para el lienzo. */
export async function discardFlowDraft(flowId: string): Promise<FlowActionResult<{ nodes: unknown[]; edges: unknown[] }>> {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(flowId)) return { ok: false, error: NOT_FOUND };
  const { data, error } = await ctx.supabase
    .from("flows")
    .update({ draft_nodes: null, draft_edges: null, draft_updated_at: null })
    .eq("id", flowId)
    .eq("workspace_id", ctx.workspace.id)
    .select("nodes, edges")
    .maybeSingle();
  if (error) return { ok: false, error: "No pude descartar los cambios. Probá de nuevo." };
  if (!data) return { ok: false, error: NOT_FOUND };
  revalidatePath("/dashboard/flows");
  return {
    ok: true,
    nodes: Array.isArray(data.nodes) ? (data.nodes as unknown[]) : [],
    edges: Array.isArray(data.edges) ? (data.edges as unknown[]) : [],
  };
}

/**
 * Nombre, descripcion y categorias. Es informacion de la automatizacion, no de lo que hace: se guarda al instante y
 * no pasa por el borrador.
 */
export async function updateFlowDetails(input: {
  flowId: string;
  name?: string;
  description?: string | null;
  categories?: string[];
}): Promise<FlowActionResult<{ name?: string; description?: string | null; categories?: string[] }>> {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(input.flowId)) return { ok: false, error: NOT_FOUND };

  const update: { name?: string; description?: string | null; categories?: string[] } = {};
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name) return { ok: false, error: "Ponele un nombre a la automatización." };
    update.name = name;
  }
  if (input.description !== undefined) update.description = normalizeDescription(input.description);
  if (input.categories !== undefined) update.categories = normalizeCategories(input.categories);
  if (Object.keys(update).length === 0) return { ok: true };

  const { data, error } = await ctx.supabase
    .from("flows")
    .update(update)
    .eq("id", input.flowId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[flows] no pude guardar los detalles:", error.message);
    return { ok: false, error: "No se pudieron guardar los detalles. Probá de nuevo." };
  }
  if (!data) return { ok: false, error: NOT_FOUND };
  revalidatePath("/dashboard/flows");
  return { ok: true, ...update };
}

/** Las categorias que ya usan las automatizaciones del negocio, de la mas usada a la menos usada. */
export async function listFlowCategories(): Promise<Array<{ name: string; count: number }>> {
  const ctx = await getPermissionAction("flows.view");
  if (!ctx) return [];
  const { data, error } = await ctx.supabase.from("flows").select("categories").eq("workspace_id", ctx.workspace.id).limit(2000);
  if (error) {
    console.error("[flows] no pude leer las categorias:", error.message);
    return [];
  }
  return categorySuggestions((data ?? []) as Array<{ categories?: string[] | null }>);
}

/**
 * Lo que necesita la seccion «Adjuntos» de «Enviar email»: si la persona puede subir un recurso nuevo (administrar
 * Recursos es `templates.manage`) y el nombre del negocio (lo usa el formulario de Recursos para sus ejemplos).
 */
export async function getEmailAttachmentContext(): Promise<{ canUpload: boolean; workspaceName: string }> {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { canUpload: false, workspaceName: "" };
  return { canUpload: ctx.can("templates.manage"), workspaceName: ctx.workspace.name ?? "" };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * En cuantas automatizaciones se usa un recurso (como adjunto de un email o en «Enviar recurso»), contando lo publicado
 * y los cambios sin publicar. Lo usa Recursos para avisar antes de borrarlo: es solo un aviso, no bloquea. Con la
 * sesion (la RLS de `flows`); sin permiso para ver automatizaciones, 0.
 */
export async function countFlowsUsingAsset(assetId: string): Promise<number> {
  if (!UUID_RE.test(assetId)) return 0;
  const ctx = await getPermissionAction("flows.view");
  if (!ctx) return 0;
  const asAttachment = JSON.stringify([{ data: { attachments: [{ assetId }] } }]);
  const asAsset = JSON.stringify([{ data: { assetId } }]);
  // Cuatro consultas simples (`@>` sobre el jsonb) en vez de un `or`: los dos puntos del JSON son caracteres
  // reservados adentro de un `or` de PostgREST.
  const queries = (["nodes", "draft_nodes"] as const).flatMap((column) =>
    [asAttachment, asAsset].map((value) =>
      ctx.supabase.from("flows").select("id").eq("workspace_id", ctx.workspace.id).filter(column, "cs", value).limit(100),
    ),
  );
  const results = await Promise.all(queries);
  const ids = new Set<string>();
  for (const { data, error } of results) {
    if (error) {
      console.error("[flows] no pude contar el uso del recurso:", error.message);
      continue;
    }
    for (const row of data ?? []) ids.add((row as { id: string }).id);
  }
  return ids.size;
}
