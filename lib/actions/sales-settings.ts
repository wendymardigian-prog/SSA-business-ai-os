"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";
import { checkEnabledMethods } from "@/lib/sales/settings";

/**
 * Ajustes de Ventas del workspace (Ajustes > General > Ventas). Pide
 * `settings.manage`. Cada campo es opcional: lo que no viene no se toca.
 */
export async function updateSalesSettings(input: {
  enabledPaymentMethods?: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("settings.manage");
  if (!ctx) return { ok: false, error: "Solo quien puede cambiar la configuración maneja los ajustes de Ventas" };
  const { workspace, supabase, user } = ctx;

  const patch: Record<string, unknown> = {};
  const changes: Record<string, { old: Json; new: Json }> = {};

  const { data: before } = await supabase.from("workspaces").select("enabled_payment_methods").eq("id", workspace.id).maybeSingle();

  if (input.enabledPaymentMethods !== undefined) {
    const checked = checkEnabledMethods(input.enabledPaymentMethods);
    if (!checked.ok) return checked;
    patch.enabled_payment_methods = checked.methods;
    changes.enabled_payment_methods = { old: (before?.enabled_payment_methods ?? null) as Json, new: checked.methods as Json };
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from("workspaces").update(patch as never).eq("id", workspace.id);
  if (error) {
    console.error("[sales-settings] no pude guardar:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    changes,
    metadata: { section: "sales_settings" },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}
