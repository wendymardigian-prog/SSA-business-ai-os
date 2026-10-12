"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import type { Json } from "@/lib/types/database";
import { checkEnabledMethods, checkGraceDays, checkMaxDiscountPercent } from "@/lib/sales/settings";
import { ensureSalesTemplateFlows } from "@/lib/sales/automation/templates-run";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Ajustes de Ventas del workspace (Ajustes > General > Ventas). Pide
 * `settings.manage`. Cada campo es opcional: lo que no viene no se toca.
 */
export async function updateSalesSettings(input: {
  enabledPaymentMethods?: unknown;
  /** Vacío/null = sin tope. */
  maxDiscountPercent?: unknown;
  overdueGraceDays?: unknown;
  /** «Crear flujos de cobranza»: al prenderlo se crean (apagados) los que falten. */
  autoCreateFlows?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("settings.manage");
  if (!ctx) return { ok: false, error: "Solo quien puede cambiar la configuración maneja los ajustes de Ventas" };
  const { workspace, supabase, user } = ctx;

  const patch: Record<string, unknown> = {};
  const changes: Record<string, { old: Json; new: Json }> = {};

  const { data: before } = await supabase.from("workspaces").select("enabled_payment_methods, max_discount_percent, overdue_grace_days, sales_auto_create_flows").eq("id", workspace.id).maybeSingle();

  if (input.enabledPaymentMethods !== undefined) {
    const checked = checkEnabledMethods(input.enabledPaymentMethods);
    if (!checked.ok) return checked;
    patch.enabled_payment_methods = checked.methods;
    changes.enabled_payment_methods = { old: (before?.enabled_payment_methods ?? null) as Json, new: checked.methods as Json };
  }

  if (input.maxDiscountPercent !== undefined) {
    const checked = checkMaxDiscountPercent(input.maxDiscountPercent);
    if (!checked.ok) return checked;
    patch.max_discount_percent = checked.value;
    changes.max_discount_percent = { old: (before?.max_discount_percent ?? null) as Json, new: checked.value };
  }

  if (input.overdueGraceDays !== undefined) {
    const checked = checkGraceDays(input.overdueGraceDays);
    if (!checked.ok) return checked;
    patch.overdue_grace_days = checked.value;
    changes.overdue_grace_days = { old: (before?.overdue_grace_days ?? null) as Json, new: checked.value };
  }

  if (input.autoCreateFlows !== undefined) {
    patch.sales_auto_create_flows = input.autoCreateFlows === true;
    changes.sales_auto_create_flows = { old: (before?.sales_auto_create_flows ?? null) as Json, new: input.autoCreateFlows === true };
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from("workspaces").update(patch as never).eq("id", workspace.id);
  if (error) {
    console.error("[sales-settings] no pude guardar:", error.message);
    return { ok: false, error: "No pude guardar el cambio" };
  }

  // Al prender la opción, se crean (apagados) los flujos de cobranza que falten.
  if (input.autoCreateFlows === true) await ensureSalesTemplateFlows(await createServiceClient(), workspace.id, { force: true });

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
