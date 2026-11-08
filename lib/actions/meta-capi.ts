"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { META_CAPI_PROVIDER_ID } from "@/lib/meta/capi/config";
import type { Json } from "@/lib/types/database";

/**
 * La sección propia de la tarjeta «Meta: API de Conversiones» (00328): el interruptor «Mandar cada pago cobrado como
 * compra». Pide `integrations.manage`, como el resto de la tarjeta. El token y el Pixel se guardan con el formulario
 * genérico (`saveIntegration`), que conserva este valor.
 */
export async function setMetaCapiPurchase(input: { enabled: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para configurar la API de Conversiones." };
  const { workspace, supabase, user } = ctx;

  const { data: existing } = await supabase
    .from("integration_configs")
    .select("id, config, is_active")
    .eq("workspace_id", workspace.id)
    .eq("type", "meta")
    .eq("provider", META_CAPI_PROVIDER_ID)
    .maybeSingle();
  if (!existing?.is_active) return { ok: false, error: "Primero guardá el Pixel y el token." };

  const before = (existing.config ?? {}) as Record<string, Json>;
  const value = input.enabled === true ? "true" : "false";
  if (before.purchase_enabled === value) return { ok: true };

  const { error } = await supabase
    .from("integration_configs")
    .update({ config: { ...before, purchase_enabled: value } })
    .eq("id", existing.id);
  if (error) {
    console.error("[meta-capi] no pude guardar el interruptor de compras:", error.code ?? "error");
    return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "channel",
    entityId: workspace.id,
    action: "update",
    changes: { purchase_enabled: { old: before.purchase_enabled ?? null, new: value } },
    metadata: { provider: META_CAPI_PROVIDER_ID, kind: "meta_capi_purchase" },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/settings/integrations", "layout");
  return { ok: true };
}
