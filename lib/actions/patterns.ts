"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { moveText, createCategoryAndMove, renameCategory, mergeCategory } from "@/lib/patterns/corrections";

const NOT_ADMIN = "Solo Owner y Admin pueden corregir categorías";

/** F21: mover un texto a otra categoría. */
export async function moveTextAction(textId: string, categoryId: string) {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false as const, error: NOT_ADMIN };
  const r = await moveText(ctx.supabase, { workspaceId: ctx.workspace.id, textId, categoryId, userId: ctx.user.id });
  revalidatePath("/dashboard/dashboards/chat");
  return r;
}

/** F21: crear una categoría nueva y mover el texto ahí. */
export async function createCategoryAndMoveAction(direction: "inbound" | "outbound", name: string, textId: string) {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false as const, error: NOT_ADMIN };
  const r = await createCategoryAndMove(ctx.supabase, { workspaceId: ctx.workspace.id, direction, name, textId, userId: ctx.user.id });
  revalidatePath("/dashboard/dashboards/chat");
  return r;
}

/** F21: renombrar o editar la descripción de una categoría ("Otro" protegida). */
export async function renameCategoryAction(categoryId: string, patch: { name?: string; description?: string }) {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false as const, error: NOT_ADMIN };
  const r = await renameCategory(ctx.supabase, { workspaceId: ctx.workspace.id, categoryId, ...patch, userId: ctx.user.id });
  revalidatePath("/dashboard/dashboards/chat");
  return r;
}

/** F21: unir una categoría con otra. */
export async function mergeCategoryAction(sourceId: string, targetId: string) {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false as const, error: NOT_ADMIN };
  const r = await mergeCategory(ctx.supabase, { workspaceId: ctx.workspace.id, sourceId, targetId, userId: ctx.user.id });
  revalidatePath("/dashboard/dashboards/chat");
  return r;
}
