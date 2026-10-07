"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { canRefreshNow } from "@/lib/metrics/sync";
import { queueMetricsSync } from "@/lib/metrics/queue";
import { SOCIAL_PLATFORMS } from "@/lib/social/profile-page";
import { platformLabel } from "@/lib/platforms";
import type { SocialPlatform } from "@/lib/types/database";

/**
 * "Actualizar ahora" (F47).
 *
 * Encola la recoleccion y vuelve. No espera: leer una red puede tardar
 * minutos y una pantalla trabada esos minutos es peor que un aviso de "se
 * esta actualizando".
 *
 * El tope de 15 minutos no es capricho: cada actualizacion son decenas de
 * llamadas contra APIs con cuota diaria. Pero es POR CUENTA: que Instagram se
 * haya leido hace un minuto no dice nada de YouTube, y una red recien
 * conectada no puede quedar trabada por la espera de las otras.
 *
 * - Con `platform`: solo la cuenta de esa red (hay una por red).
 * - Sin `platform` ("Todas"): cada cuenta cuya propia espera ya paso; las
 *   demas se saltean.
 */

export type RefreshResult =
  | { ok: true; queued: number }
  | { ok: false; error: string };

function minutesText(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

export async function refreshMetricsNow(platform?: string | null): Promise<RefreshResult> {
  const ctx = await getAdminContext();
  if (!ctx) return { ok: false, error: "Solo Owner y Admin pueden actualizar las metricas" };

  if (platform && !(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) {
    return { ok: false, error: "Esa red no existe" };
  }

  let query = ctx.supabase
    .from("social_accounts")
    .select("id, platform, profile_synced_at")
    .eq("workspace_id", ctx.workspace.id)
    .eq("is_active", true);
  if (platform) query = query.eq("platform", platform as SocialPlatform);

  const { data: accounts, error: readError } = await query;
  if (readError) {
    console.error("[metricas] no pude leer las cuentas para actualizar:", readError.message);
    return { ok: false, error: "No pude leer las cuentas. Proba de nuevo en un momento." };
  }

  if (!accounts || accounts.length === 0) {
    return {
      ok: false,
      error: platform
        ? `${platformLabel(platform)} no esta conectada`
        : "Todavia no hay ninguna cuenta conectada",
    };
  }

  const now = new Date();
  const ready: string[] = [];
  let soonestWait: number | null = null;

  for (const account of accounts) {
    const decision = canRefreshNow(account.profile_synced_at, now);
    if (decision.allowed) {
      ready.push(account.id);
    } else {
      soonestWait = Math.min(soonestWait ?? Infinity, decision.retryInSeconds);
    }
  }

  if (ready.length === 0) {
    const wait = minutesText(soonestWait ?? 60);
    return {
      ok: false,
      error: platform
        ? `${platformLabel(platform)} se actualizo hace poco. Proba de nuevo en ${wait}.`
        : `Todas las redes se actualizaron hace poco. Proba de nuevo en ${wait}.`,
    };
  }

  // La cola es interna y esta cerrada a los usuarios (00046): encola el
  // servidor.
  let queued: number;
  try {
    const service = await createServiceClient();
    const result = await queueMetricsSync(service, ctx.workspace.id, ready, now);
    queued = result.queued;
  } catch (err) {
    console.error(
      "[metricas] no pude encolar la actualizacion:",
      err instanceof Error ? err.message : err,
    );
    return { ok: false, error: "No pude pedir la actualizacion. Proba de nuevo en un momento." };
  }

  if (queued === 0) {
    return { ok: false, error: "Ya se esta actualizando. Espera un momento y recarga." };
  }

  revalidatePath("/dashboard/dashboards");
  revalidatePath("/dashboard/social");
  return { ok: true, queued };
}
