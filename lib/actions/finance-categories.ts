"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { CATEGORY_COLORS, CATEGORY_GROUPS, CATEGORY_NAME_MAX, newCategoryKey, parseCategories, validateCategoriesUpdate, type ExpenseCategory } from "@/lib/finance/categories";
import { parseFinanceSettings } from "@/lib/finance/settings";
import type { Json } from "@/lib/types/database";

/**
 * Categorías de gasto (GF4). Viven en `workspaces.finance_settings.expense_categories`; se escriben SOLO acá,
 * con el cliente de servicio, DESPUÉS de `expenses.manage`, tocando solo esa clave del jsonb y en el workspace de la
 * sesión (la RLS de `workspaces` es de Admin y un rol de contabilidad no lo es).
 */

const NO_PERMISSION = "No tenés permiso para cambiar las categorías";

export type CategoriesResult = { ok: true; categories: ExpenseCategory[] } | { ok: false; error: string };

/** Lo que manda la pantalla: sin `system` ni `archived_at` (los decide el servidor) y con `key` solo si ya existe. */
const itemSchema = z.object({
  key: z.string().optional(),
  name: z.string().max(400),
  color: z.enum(CATEGORY_COLORS),
  group: z.enum(CATEGORY_GROUPS),
  archived: z.boolean(),
});

export async function saveExpenseCategories(input: unknown): Promise<CategoriesResult> {
  const ctx = await getPermissionAction("expenses.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const parsed = z.array(itemSchema).max(100).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Las categorías no son válidas" };

  const service = await createServiceClient();
  const { data: row, error: readError } = await service.from("workspaces").select("finance_settings").eq("id", ctx.workspace.id).maybeSingle();
  if (readError) {
    console.error("[finance] no pude leer la configuración:", readError.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }
  const current = (row as { finance_settings?: unknown } | null)?.finance_settings;
  const settings = parseFinanceSettings(current);
  const before = settings.expense_categories;
  const byKey = new Map(before.map((c) => [c.key, c]));

  const taken = before.map((c) => c.key);
  const now = new Date().toISOString();
  const after: ExpenseCategory[] = [];
  for (const item of parsed.data) {
    const existing = item.key ? byKey.get(item.key) : undefined;
    if (item.key && !existing) return { ok: false, error: "Hay una categoría que no existe" };
    const name = item.name.trim();
    if (!name) return { ok: false, error: "Poné un nombre a cada categoría" };
    if (name.length > CATEGORY_NAME_MAX) return { ok: false, error: `El nombre puede tener hasta ${CATEGORY_NAME_MAX} caracteres` };
    const key = existing?.key ?? newCategoryKey(name, taken);
    if (!existing) taken.push(key);
    after.push({
      key,
      name,
      color: item.color,
      group: item.group,
      system: existing?.system ?? false,
      // Archivar conserva la fecha original; restaurar la limpia.
      archived_at: item.archived ? (existing?.archived_at ?? now) : null,
    });
  }

  // Qué plantillas activas usan cada categoría (para no archivar una en uso).
  const archivedNow = after.filter((c) => c.archived_at && !byKey.get(c.key)?.archived_at).map((c) => c.key);
  const usedByRecurring: Record<string, string[]> = {};
  if (archivedNow.length > 0) {
    const { data: templates } = await ctx.supabase.from("recurring_expenses").select("concept, category_key").eq("workspace_id", ctx.workspace.id).eq("is_active", true).in("category_key", archivedNow);
    for (const t of (templates ?? []) as Array<{ concept: string; category_key: string }>) (usedByRecurring[t.category_key] ??= []).push(t.concept);
  }

  const valid = validateCategoriesUpdate(before, after, usedByRecurring);
  if (!valid.ok) return valid;

  const nextSettings = { ...(current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {}), expense_categories: after };
  const { error } = await service.from("workspaces").update({ finance_settings: nextSettings as unknown as Json } as never).eq("id", ctx.workspace.id);
  if (error) {
    console.error("[finance] no pude guardar las categorías:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }
  await logAudit({
    supabase: ctx.supabase, workspaceId: ctx.workspace.id, entityType: "workspace", entityId: ctx.workspace.id, action: "finance.categories_updated",
    changes: { expense_categories: { old: before as unknown as Json, new: after as unknown as Json } },
    performedBy: ctx.user.id,
  });
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/finanzas");
  return { ok: true, categories: parseCategories(after) };
}
