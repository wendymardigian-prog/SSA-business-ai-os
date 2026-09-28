"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction, getPermissionContext } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { AREA_COLORS, canArchive, reorderSiblings, validateCategoryName } from "@/lib/scheduling/categories";
import { listCategories, toCategoryRow } from "@/lib/scheduling/data/event-types";

/**
 * Categorias de agenda (F50): areas y tipos. Escribe quien tiene
 * `scheduling.manage_categories` (o es admin); leer, cualquier miembro.
 * Nada se borra: se archiva.
 */

const PATH = "/dashboard/agenda/configuracion/categorias";

export type CategoryActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

async function editor() {
  const ctx = await getPermissionAction("scheduling.manage_categories");
  if (ctx) return ctx;
  // Owner y Admin tienen la clave, asi que esto solo falla para los demas.
  return null;
}

export async function createCategory(input: { name: string; parentId?: string | null; color?: string | null }): Promise<CategoryActionResult<{ id: string }>> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar las categorías" };

  const all = (await listCategories(ctx.supabase, ctx.workspace.id)).map(toCategoryRow);
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = all.find((c) => c.id === parentId);
    if (!parent) return { ok: false, error: "No encontré esa área" };
    if (parent.parent_id !== null) return { ok: false, error: "Solo hay dos niveles: un tipo no puede tener tipos adentro" };
  }
  const siblings = all.filter((c) => c.parent_id === parentId);
  const checked = validateCategoryName(input.name, siblings);
  if (!checked.ok) return { ok: false, error: checked.message };

  const color = parentId ? null : (input.color && (AREA_COLORS as readonly string[]).includes(input.color) ? input.color : AREA_COLORS[siblings.length % AREA_COLORS.length]);

  const { data, error } = await ctx.supabase
    .from("booking_categories")
    .insert({
      workspace_id: ctx.workspace.id,
      parent_id: parentId,
      name: checked.name,
      color,
      position: siblings.length,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.code === "23505" ? "Ya existe una con ese nombre" : `No pude crear la categoría: ${error?.message ?? ""}` };
  }
  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "booking_category", entityId: data.id, action: "category.created", metadata: { name: checked.name, parent_id: parentId }, performedBy: ctx.user.id });
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

export async function renameCategory(input: { id: string; name: string; color?: string | null }): Promise<CategoryActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar las categorías" };

  const all = (await listCategories(ctx.supabase, ctx.workspace.id)).map(toCategoryRow);
  const current = all.find((c) => c.id === input.id);
  if (!current) return { ok: false, error: "No encontré esa categoría" };
  const siblings = all.filter((c) => c.parent_id === current.parent_id);
  const checked = validateCategoryName(input.name, siblings, current.id);
  if (!checked.ok) return { ok: false, error: checked.message };

  const patch: { name: string; color?: string | null } = { name: checked.name };
  if (current.parent_id === null && input.color && (AREA_COLORS as readonly string[]).includes(input.color)) patch.color = input.color;

  const { error } = await ctx.supabase.from("booking_categories").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: `No pude guardar: ${error.message}` };
  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "booking_category", entityId: input.id, action: "category.updated", changes: { name: { old: current.name, new: checked.name } }, performedBy: ctx.user.id });
  revalidatePath(PATH);
  return { ok: true };
}

export async function archiveCategory(input: { id: string; restore?: boolean }): Promise<CategoryActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar las categorías" };

  const all = (await listCategories(ctx.supabase, ctx.workspace.id)).map(toCategoryRow);
  const current = all.find((c) => c.id === input.id);
  if (!current) return { ok: false, error: "No encontré esa categoría" };

  if (!input.restore) {
    const decision = canArchive(current);
    if (!decision.ok) return { ok: false, error: decision.reason ?? "No se puede archivar" };
  }

  const { error } = await ctx.supabase
    .from("booking_categories")
    .update({ archived_at: input.restore ? null : new Date().toISOString() })
    .eq("id", input.id);
  if (error) {
    return { ok: false, error: error.code === "23505" ? "Ya hay una activa con ese nombre: renombrala antes de restaurar" : `No pude archivar: ${error.message}` };
  }
  // Archivar un área archiva sus tipos: no tiene sentido un tipo huérfano.
  if (current.parent_id === null) {
    await ctx.supabase
      .from("booking_categories")
      .update({ archived_at: input.restore ? null : new Date().toISOString() })
      .eq("parent_id", input.id);
  }
  await logAudit({ supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "booking_category", entityId: input.id, action: "category.archived", metadata: { restore: Boolean(input.restore) }, performedBy: ctx.user.id });
  revalidatePath(PATH);
  return { ok: true };
}

export async function reorderCategory(input: { id: string; toIndex: number }): Promise<CategoryActionResult> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: "No tenes permiso para administrar las categorías" };
  const all = (await listCategories(ctx.supabase, ctx.workspace.id)).map(toCategoryRow);
  const current = all.find((c) => c.id === input.id);
  if (!current) return { ok: false, error: "No encontré esa categoría" };
  const siblings = all.filter((c) => c.parent_id === current.parent_id && !c.archived_at);
  for (const { id, position } of reorderSiblings(siblings, input.id, input.toIndex)) {
    await ctx.supabase.from("booking_categories").update({ position }).eq("id", id);
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Lo que la pantalla necesita: el catálogo con el permiso de escritura resuelto. */
export async function loadCategories(): Promise<CategoryActionResult<{ categories: ReturnType<typeof toCategoryRow>[]; canEdit: boolean }>> {
  const ctx = await getPermissionContext();
  const rows = await listCategories(ctx.supabase, ctx.workspace.id);
  return { ok: true, data: { categories: rows.map(toCategoryRow), canEdit: ctx.can("scheduling.manage_categories") } };
}
