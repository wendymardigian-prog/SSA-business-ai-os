/**
 * Encola la recoleccion de metricas de cada cuenta (F47).
 *
 * Corre CADA HORA y se queda con los workspaces cuya hora local es las 3 de
 * la mañana. Un cron por workspace seria lo mismo con una pieza mas que
 * mantener por cada negocio, y las zonas con medias horas (India, Nepal)
 * entran igual porque se compara la hora local, no el desfase.
 *
 * No lee las metricas: las ENCOLA. Cada cuenta es un job aparte, asi una red
 * lenta o caida no deja a las otras sin datos. Antes de encolar si vuelve a
 * leer QUE cuentas hay (`syncSocialAccounts`): una cuenta conectada en Zernio
 * despues de guardar la clave aparece sola a la mañana siguiente.
 *
 * Ponerse al dia (Tiron 2, E1): si la corrida de las 3 de la mañana se perdio (una caida justo a esa hora), las
 * cuentas publicitarias atrasadas se encolan igual en la hora siguiente. Ver `adAccountNeedsCatchUp`.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { scheduleJob } from "@/lib/scheduler";
import { isSyncHour } from "@/lib/metrics/rules";
import { queueMetricsSync } from "@/lib/metrics/queue";
import { syncSocialAccounts } from "@/lib/social/accounts";
import { adAccountsToCatchUp, adAccountsToSync, META_ADS_SYNC_JOB } from "@/lib/jobs/handlers/meta-ads-sync";

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = await createServiceClient();
  const now = new Date();

  const { data: workspaces, error } = await supabase.from("workspaces").select("id, timezone");

  if (error) {
    console.error("[metrics-sync] no pude leer los workspaces:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const due = (workspaces ?? []).filter((w) => isSyncHour(now, w.timezone || "UTC"));

  let queued = 0;
  const dueIds = new Set(due.map((w) => w.id));

  // Las cuentas publicitarias que perdieron su corrida (de cualquier workspace; las de los que tocan ya van abajo).
  let caughtUp = 0;
  for (const { workspaceId, adAccountId } of await adAccountsToCatchUp(supabase, now)) {
    if (dueIds.has(workspaceId)) continue;
    try {
      await scheduleJob(supabase, META_ADS_SYNC_JOB, { workspaceId, adAccountId }, now, `meta-ads:${adAccountId}:${now.toISOString().slice(0, 13)}`);
      caughtUp += 1;
    } catch {
      // Ya habia uno pendiente.
    }
  }
  queued += caughtUp;

  if (due.length === 0) {
    return NextResponse.json({ ok: true, queued, caughtUp, skipped: "no es la hora de ningun workspace" });
  }

  for (const workspace of due) {
    // Antes de leer las metricas, que cuentas hay. Una cuenta que se conecto en Zernio DESPUES de guardar la clave
    // (la segunda Instagram) no existia para el sistema hasta que alguien apretara "Sincronizar cuentas": no
    // aparecia en Social ni se le leia nada. Un fallo aca no frena las metricas de las cuentas que ya estaban.
    try {
      const synced = await syncSocialAccounts(supabase, workspace.id);
      for (const warning of synced.warnings) console.warn(`[metrics-sync] cuentas del workspace ${workspace.id}: ${warning}`);
    } catch (err) {
      console.error(
        `[metrics-sync] no pude sincronizar las cuentas del workspace ${workspace.id}:`,
        err instanceof Error ? err.message : err,
      );
    }

    const { data: accounts } = await supabase
      .from("social_accounts")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("is_active", true);

    // Una cuenta con un job pendiente de esta hora no suma otro (la clave de
    // dedupe lo impide). Si la cola falla por otra cosa, este workspace se
    // registra y los demas siguen.
    try {
      const result = await queueMetricsSync(
        supabase,
        workspace.id,
        (accounts ?? []).map((a) => a.id),
        now,
      );
      queued += result.queued;
    } catch (err) {
      console.error(
        `[metrics-sync] no pude encolar las cuentas del workspace ${workspace.id}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Las cuentas publicitarias van en su propio job: Meta tiene su cuota y
    // sus limites, y no tiene por que compartir suerte con Instagram.
    for (const adAccountId of await adAccountsToSync(supabase, workspace.id)) {
      try {
        await scheduleJob(
          supabase,
          META_ADS_SYNC_JOB,
          { workspaceId: workspace.id, adAccountId },
          now,
          `meta-ads:${adAccountId}:${now.toISOString().slice(0, 13)}`,
        );
        queued += 1;
      } catch {
        // Ya habia uno pendiente.
      }
    }
  }

  return NextResponse.json({ ok: true, queued, caughtUp, workspaces: due.length });
}
