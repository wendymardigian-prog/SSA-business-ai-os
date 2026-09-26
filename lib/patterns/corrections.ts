import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";

type Db = SupabaseClient<Database>;

export interface CorrectionResult {
  ok: boolean;
  error?: string;
  categoryId?: string;
}

/**
 * Correcciones de categorías desde el dashboard (F21). Lógica pura con el
 * cliente inyectado; la Server Action la envuelve con getAdminContext (un
 * Member recibe 403 antes de llegar acá). "Otro" está protegida.
 */

/** "Mover a…": reasigna un texto y lo marca como corregido a mano (nunca se pisa). */
export async function moveText(client: Db, args: { workspaceId: string; textId: string; categoryId: string; userId: string; now?: Date }): Promise<CorrectionResult> {
  const now = (args.now ?? new Date()).toISOString();
  const { error } = await client
    .from("message_texts")
    .update({ category_id: args.categoryId, source: "human", review_result: "corrected", reviewed_by: args.userId, reviewed_at: now })
    .eq("id", args.textId)
    .eq("workspace_id", args.workspaceId);
  if (error) return { ok: false, error: error.message };
  await logAudit({ supabase: client, workspaceId: args.workspaceId, entityType: "message_text", entityId: args.textId, action: "update", changes: { category_id: { old: null, new: args.categoryId } }, metadata: { section: "patterns", op: "move" }, performedBy: args.userId });
  return { ok: true, categoryId: args.categoryId };
}

/** "+ Nueva categoría": la crea (created_by user) y mueve el texto ahí. */
export async function createCategoryAndMove(client: Db, args: { workspaceId: string; direction: "inbound" | "outbound"; name: string; textId: string; userId: string; now?: Date }): Promise<CorrectionResult> {
  const name = args.name.trim();
  if (!name) return { ok: false, error: "El nombre no puede estar vacío" };
  const { data, error } = await client
    .from("message_categories")
    .insert({ workspace_id: args.workspaceId, direction: args.direction, name, created_by: "user", created_by_user_id: args.userId })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.code === "23505" ? "Ya existe una categoría con ese nombre" : (error?.message ?? "No pude crear la categoría") };
  await logAudit({ supabase: client, workspaceId: args.workspaceId, entityType: "message_category", entityId: data.id, action: "create", metadata: { section: "patterns", name }, performedBy: args.userId });
  return moveText(client, { workspaceId: args.workspaceId, textId: args.textId, categoryId: data.id, userId: args.userId, now: args.now });
}

/** Renombrar / editar descripción. "Otro" y las de sistema no se pueden renombrar. */
export async function renameCategory(client: Db, args: { workspaceId: string; categoryId: string; name?: string; description?: string; userId: string }): Promise<CorrectionResult> {
  const { data: cat } = await client.from("message_categories").select("is_fallback, created_by, name").eq("id", args.categoryId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!cat) return { ok: false, error: "La categoría no existe" };
  if ((cat as { is_fallback: boolean }).is_fallback) return { ok: false, error: '"Otro" no se puede renombrar' };
  const patch: { name?: string; description?: string; updated_at: string } = { updated_at: new Date().toISOString() };
  if (args.name !== undefined) patch.name = args.name.trim();
  if (args.description !== undefined) patch.description = args.description;
  const { error } = await client.from("message_categories").update(patch).eq("id", args.categoryId).eq("workspace_id", args.workspaceId);
  if (error) return { ok: false, error: error.code === "23505" ? "Ya existe una categoría con ese nombre" : error.message };
  await logAudit({ supabase: client, workspaceId: args.workspaceId, entityType: "message_category", entityId: args.categoryId, action: "update", changes: { name: { old: (cat as { name: string }).name, new: patch.name ?? (cat as { name: string }).name } }, metadata: { section: "patterns" }, performedBy: args.userId });
  return { ok: true };
}

/** "Unir con…": mueve todas las filas a la categoría destino y archiva la origen. */
export async function mergeCategory(client: Db, args: { workspaceId: string; sourceId: string; targetId: string; userId: string; now?: Date }): Promise<CorrectionResult> {
  if (args.sourceId === args.targetId) return { ok: false, error: "No se puede unir una categoría consigo misma" };
  const { data: src } = await client.from("message_categories").select("is_fallback").eq("id", args.sourceId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!src) return { ok: false, error: "La categoría origen no existe" };
  if ((src as { is_fallback: boolean }).is_fallback) return { ok: false, error: '"Otro" no se puede unir' };
  const now = (args.now ?? new Date()).toISOString();
  const { error: moveErr } = await client.from("message_texts").update({ category_id: args.targetId }).eq("workspace_id", args.workspaceId).eq("category_id", args.sourceId);
  if (moveErr) return { ok: false, error: moveErr.message };
  const { error } = await client.from("message_categories").update({ merged_into_id: args.targetId, archived_at: now }).eq("id", args.sourceId).eq("workspace_id", args.workspaceId);
  if (error) return { ok: false, error: error.message };
  await logAudit({ supabase: client, workspaceId: args.workspaceId, entityType: "message_category", entityId: args.sourceId, action: "update", changes: { merged_into_id: { old: null, new: args.targetId } }, metadata: { section: "patterns", op: "merge" }, performedBy: args.userId });
  return { ok: true };
}
