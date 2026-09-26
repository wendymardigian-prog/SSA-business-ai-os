"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { scheduleJob } from "@/lib/scheduler";
import { canRefreshNow } from "@/lib/metrics/sync";
import { METRICS_SYNC_JOB } from "@/lib/jobs/handlers/metrics-sync";

/**
 * "Actualizar ahora" (F47).
 *
 * Encola la recoleccion de todas las cuentas y vuelve. No espera: leer cinco
 * redes puede tardar minutos y una pantalla trabada esos minutos es peor que
 * un aviso de "se esta actualizando".
 *
 * El tope de 15 minutos no es capricho: cada actualizacion son decenas de
 * llamadas contra APIs con cuota diaria.
 */

export type RefreshResult =
  | { ok: true; queued: number }
  | { ok: false; error: string };

export async function refreshMetricsNow(): Promise<RefreshResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden actualizar las metricas" };

  const { data: accounts } = await ctx.supabase
    .from("social_accounts")
    .select("id, profile_synced_at")
    .eq("workspace_id", ctx.workspace.id)
    .eq("is_active", true);

  if (!accounts || accounts.length === 0) {
    return { ok: false, error: "Todavia no hay ninguna cuenta conectada" };
  }

  // El tope se mira contra la cuenta MAS reciente: si cualquiera se
  // actualizo hace cinco minutos, la vuelta entera se actualizo hace cinco
  // minutos.
  const lastSynced = accounts
    .map((a) => a.profile_synced_at)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);

  const decision = canRefreshNow(lastSynced ?? null, new Date());
  if (!decision.allowed) return { ok: false, error: decision.message };

  // La cola es interna y esta cerrada a los usuarios (00046): encola el
  // servidor.
  const service = await createServiceClient();
  const now = new Date();
  let queued = 0;

  for (const account of accounts) {
    try {
      await scheduleJob(
        service,
        METRICS_SYNC_JOB,
        { workspaceId: ctx.workspace.id, socialAccountId: account.id },
        now,
        `metrics:${account.id}:${now.toISOString().slice(0, 13)}`,
      );
      queued += 1;
    } catch {
      // Ya hay uno pendiente para esta cuenta y esta hora: no hace falta otro.
    }
  }

  if (queued === 0) {
    return { ok: false, error: "Ya se esta actualizando. Espera un momento y recarga." };
  }

  revalidatePath("/dashboard/dashboards");
  revalidatePath("/dashboard/social");
  return { ok: true, queued };
}
