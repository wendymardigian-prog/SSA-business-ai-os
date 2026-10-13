"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { scheduleJob } from "@/lib/scheduler";
import { META_ADS_SYNC_JOB } from "@/lib/jobs/handlers/meta-ads-sync";
import { parseMetaConfig, resolveSyncedAccount } from "@/lib/meta/accounts";
import { manualSyncKey } from "@/lib/meta/manual-sync";

export type SyncNowResult =
  | { ok: true; alreadyQueued: boolean }
  | { ok: false; error: string };

/**
 * "Sincronizar ahora": encola la sincronizacion de UNA cuenta publicitaria (metricas, catalogo y
 * miniaturas). Permiso `settings.manage`. El workspace sale SIEMPRE de la sesion y la cuenta tiene
 * que ser una de las que el negocio ya eligio sincronizar.
 */
export async function syncMetaAdsNow(adAccountId: string): Promise<SyncNowResult> {
  const ctx = await getPermissionAction("settings.manage");
  if (!ctx) return { ok: false, error: "No tenés permiso para sincronizar los anuncios. Pedile a un Admin que lo haga." };

  const service = await createServiceClient();
  const { data: row } = await service
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", ctx.workspace.id)
    .eq("type", "meta")
    .eq("provider", "meta")
    .maybeSingle();

  const resolved = resolveSyncedAccount(parseMetaConfig(row?.config).ad_accounts, adAccountId);
  if (!resolved.ok) return { ok: false, error: "Esa cuenta publicitaria no está activada para sincronizar. Activala en Integraciones." };

  try {
    await scheduleJob(
      service,
      META_ADS_SYNC_JOB,
      { workspaceId: ctx.workspace.id, adAccountId: resolved.adAccountId },
      new Date(),
      manualSyncKey(resolved.adAccountId, new Date()),
    );
  } catch (err) {
    // 23505 = ya hay un job pendiente con esa clave: la sincronizacion ya esta en camino.
    if ((err as { code?: string })?.code === "23505") return { ok: true, alreadyQueued: true };
    console.error("[meta-ads] no pude encolar la sincronizacion manual:", err instanceof Error ? err.message : err);
    return { ok: false, error: "No pude pedir la sincronización. Probá de nuevo en un rato." };
  }

  revalidatePath("/dashboard/dashboards/ads");
  return { ok: true, alreadyQueued: false };
}
