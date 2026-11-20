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
import { categoryKey, normalizeCategory, removeCategoryFrom, renameCategoryIn, sameCategories } from "@/lib/categories";

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

/** Otra persona guardó (o descartó, o publicó) después de que abriste: no se pisa. */
export interface DraftConflict {
  by: string | null;
  at: string | null;
}

export type DraftWriteResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; conflict?: DraftConflict };

const CONFLICT_ERROR = "Alguien cambió esta automatización después de que la abriste. Recargá para ver sus cambios: lo tuyo no se guardó.";

/** El nombre de quien guardó el borrador (para el aviso). Nunca lanza. */
async function draftAuthorName(workspaceId: string, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const { getWorkspaceMembers } = await import("@/lib/workspace-members");
    const members = await getWorkspaceMembers(workspaceId);
    return members.find((m) => m.userId === userId)?.name ?? null;
  } catch {
    return null;
  }
}

async function conflictFor(
  ctx: NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>,
  flowId: string,
): Promise<{ ok: false; error: string; conflict: DraftConflict }> {
  const { data } = await ctx.supabase.from("flows").select("draft_updated_by, draft_updated_at, updated_at").eq("id", flowId).maybeSingle();
  const row = (data ?? {}) as { draft_updated_by?: string | null; draft_updated_at?: string | null; updated_at?: string | null };
  return { ok: false, error: CONFLICT_ERROR, conflict: { by: await draftAuthorName(ctx.workspace.id, row.draft_updated_by), at: row.draft_updated_at ?? row.updated_at ?? null } };
}

/**
 * Guardar desde el lienzo. `expectedRev` es la revisión del borrador que vio la persona al abrir (o al guardar la vez
 * anterior): si otra persona escribió en el medio, NO se guarda y se avisa quién (00508). Sin `expectedRev` (otros
 * llamadores) se guarda como antes, igual subiendo la revisión.
 */
export async function saveFlowDraft(input: {
  flowId: string;
  name?: string;
  nodes: unknown[];
  edges: unknown[];
  viewport?: unknown;
  expectedRev?: number;
}): Promise<DraftWriteResult<{ unpublishedChanges: boolean; savedAt: string; draftRev: number }>> {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(input.flowId)) return { ok: false, error: NOT_FOUND };
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) return { ok: false, error: "Los pasos no tienen la forma esperada." };
  if (JSON.stringify({ n: input.nodes, e: input.edges }).length > MAX_GRAPH_BYTES) {
    return { ok: false, error: "La automatización es demasiado grande para guardarla." };
  }

  const { data: flow, error: readError } = await ctx.supabase
    .from("flows")
    .select("id, status, draft_rev")
    .eq("id", input.flowId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (readError) return { ok: false, error: "No pude leer la automatización. Probá de nuevo." };
  if (!flow) return { ok: false, error: NOT_FOUND };
  // Sin la columna (antes de la 00508) no hay revisión: se guarda como siempre.
  const hasRev = typeof (flow as { draft_rev?: unknown }).draft_rev === "number";
  const currentRev = hasRev ? (flow as { draft_rev: number }).draft_rev : 0;
  if (hasRev && typeof input.expectedRev === "number" && input.expectedRev !== currentRev) return conflictFor(ctx, input.flowId);

  const savedAt = new Date().toISOString();
  const published = flow.status === "published";
  const name = input.name === undefined ? null : cleanName(input.name);
  const update = {
    ...(name ? { name } : {}),
    ...(input.viewport !== undefined ? { viewport: input.viewport as Json } : {}),
    ...(published
      ? { draft_nodes: input.nodes as Json, draft_edges: input.edges as Json, draft_updated_at: savedAt }
      : { nodes: input.nodes as Json, edges: input.edges as Json }),
    ...(hasRev ? { draft_updated_by: ctx.user.id, draft_rev: currentRev + 1 } : {}),
  };
  // Condicional sobre la revisión: dos guardados a la vez, gana uno y el otro se entera.
  let query = ctx.supabase.from("flows").update(update).eq("id", input.flowId).eq("workspace_id", ctx.workspace.id);
  if (hasRev) query = query.eq("draft_rev", currentRev);
  const { data: written, error } = await query.select("id").maybeSingle();
  if (error) {
    console.error("[flows] no pude guardar la automatizacion:", error.message);
    return { ok: false, error: "No se pudo guardar. Probá de nuevo." };
  }
  if (!written) return conflictFor(ctx, input.flowId);
  revalidatePath("/dashboard/flows");
  return { ok: true, unpublishedChanges: published, savedAt, draftRev: currentRev + 1 };
}

/** Descarta los cambios sin publicar: vuelve a lo que corre. Devuelve los pasos publicados para el lienzo. */
export async function discardFlowDraft(flowId: string, expectedRev?: number): Promise<DraftWriteResult<{ nodes: unknown[]; edges: unknown[]; draftRev: number }>> {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(flowId)) return { ok: false, error: NOT_FOUND };
  const { data: flow, error: readError } = await ctx.supabase.from("flows").select("draft_rev").eq("id", flowId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (readError) return { ok: false, error: "No pude leer la automatización. Probá de nuevo." };
  if (!flow) return { ok: false, error: NOT_FOUND };
  const hasRev = typeof (flow as { draft_rev?: unknown }).draft_rev === "number";
  const currentRev = hasRev ? (flow as { draft_rev: number }).draft_rev : 0;
  // Descartar lo que otra persona guardó después de que miraste sería borrar algo que no viste.
  if (hasRev && typeof expectedRev === "number" && expectedRev !== currentRev) return conflictFor(ctx, flowId);
  let query = ctx.supabase
    .from("flows")
    .update({ draft_nodes: null, draft_edges: null, draft_updated_at: null, ...(hasRev ? { draft_updated_by: null, draft_rev: currentRev + 1 } : {}) })
    .eq("id", flowId)
    .eq("workspace_id", ctx.workspace.id);
  if (hasRev) query = query.eq("draft_rev", currentRev);
  const { data, error } = await query.select("nodes, edges").maybeSingle();
  if (error) return { ok: false, error: "No pude descartar los cambios. Probá de nuevo." };
  if (!data) return conflictFor(ctx, flowId);
  revalidatePath("/dashboard/flows");
  return {
    ok: true,
    nodes: Array.isArray(data.nodes) ? (data.nodes as unknown[]) : [],
    edges: Array.isArray(data.edges) ? (data.edges as unknown[]) : [],
    draftRev: currentRev + 1,
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

/** El nombre de la copia: "<nombre> (copia)", sin pasarse del tope. */
function copyName(name: string): string {
  const suffix = " (copia)";
  return `${name.slice(0, MAX_FLOW_NAME_LENGTH - suffix.length).trim()}${suffix}`;
}

/**
 * Duplicar una automatizacion (menu ⋯ de la lista). La copia nace en BORRADOR (no dispara nada hasta publicarla) con
 * lo que se ve en el lienzo: los cambios sin publicar si hay, si no lo publicado. Copia nombre, descripcion,
 * categorias y a que formulario o evento pertenece; no copia versiones, ejecuciones ni la marca de plantilla del
 * sistema (`template_key`): la copia es propia.
 */
export async function duplicateFlow(flowId: string): Promise<FlowActionResult<{ id: string; name: string }>> {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(flowId)) return { ok: false, error: NOT_FOUND };

  const { data: flow, error: readError } = await ctx.supabase
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (readError) {
    console.error("[flows] no pude leer la automatizacion para duplicarla:", readError.message);
    return { ok: false, error: "No se pudo duplicar. Probá de nuevo." };
  }
  if (!flow) return { ok: false, error: NOT_FOUND };

  const hasDraft = flow.draft_nodes != null;
  const name = copyName(flow.name);
  const { data, error } = await ctx.supabase
    .from("flows")
    .insert({
      workspace_id: ctx.workspace.id,
      name,
      description: flow.description,
      categories: normalizeCategories(flow.categories),
      status: "draft",
      nodes: (hasDraft ? flow.draft_nodes : flow.nodes) as Json,
      edges: ((hasDraft ? flow.draft_edges : flow.edges) ?? []) as Json,
      viewport: flow.viewport,
      form_id: flow.form_id ?? null, // @plantilla-quitar(formularios)
      event_type_id: flow.event_type_id ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[flows] no pude duplicar la automatizacion:", error?.message);
    return { ok: false, error: "No se pudo duplicar. Probá de nuevo." };
  }
  revalidatePath("/dashboard/flows");
  return { ok: true, id: data.id, name };
}

/**
 * Reescribe una categoria en todas las automatizaciones del negocio que la tienen (renombrar o quitar). Toca solo
 * las filas que cambian; no pasa por el borrador (es informacion de la automatizacion, como `updateFlowDetails`).
 */
async function rewriteFlowCategories(match: string, change: (list: string[]) => string[]): Promise<FlowActionResult<{ changed: number }>> {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const key = categoryKey(match);
  const { data, error } = await ctx.supabase.from("flows").select("id, categories").eq("workspace_id", ctx.workspace.id).limit(5000);
  if (error) {
    console.error("[flows] no pude leer las categorias:", error.message);
    return { ok: false, error: "No se pudieron leer las categorías. Probá de nuevo." };
  }
  let changed = 0;
  for (const row of (data ?? []) as Array<{ id: string; categories: string[] | null }>) {
    const current = row.categories ?? [];
    if (!current.some((c) => categoryKey(c) === key)) continue;
    const next = change(current);
    if (sameCategories(current, next)) continue;
    const { error: updateError } = await ctx.supabase.from("flows").update({ categories: next }).eq("id", row.id).eq("workspace_id", ctx.workspace.id);
    if (updateError) {
      console.error("[flows] no pude reescribir las categorias:", updateError.message);
      return { ok: false, error: "No se pudieron cambiar todas las categorías. Probá de nuevo." };
    }
    changed += 1;
  }
  revalidatePath("/dashboard/flows");
  return { ok: true, changed };
}

/** Renombrar una categoria en todas las automatizaciones. Si el nombre nuevo ya existe, quedan unidas. */
export async function renameFlowCategory(from: string, to: string): Promise<FlowActionResult<{ changed: number }>> {
  const name = normalizeCategory(to);
  if (!name) return { ok: false, error: "Escribí el nombre nuevo de la categoría." };
  return rewriteFlowCategories(from, (list) => renameCategoryIn(list, from, name));
}

/** Quitar una categoria de todas las automatizaciones (no se borra nada mas). */
export async function deleteFlowCategory(name: string): Promise<FlowActionResult<{ changed: number }>> {
  return rewriteFlowCategories(name, (list) => removeCategoryFrom(list, name));
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
