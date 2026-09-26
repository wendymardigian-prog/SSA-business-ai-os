/**
 * Encola la recoleccion de metricas de cada cuenta (F47).
 *
 * Corre CADA HORA y se queda con los workspaces cuya hora local es las 3 de
 * la mañana. Un cron por workspace seria lo mismo con una pieza mas que
 * mantener por cada negocio, y las zonas con medias horas (India, Nepal)
 * entran igual porque se compara la hora local, no el desfase.
 *
 * No sincroniza: ENCOLA. Cada cuenta es un job aparte, asi una red lenta o
 * caida no deja a las otras sin datos.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { scheduleJob } from "@/lib/scheduler";
import { isSyncHour } from "@/lib/metrics/rules";
import { METRICS_SYNC_JOB } from "@/lib/jobs/handlers/metrics-sync";
import { adAccountsToSync, META_ADS_SYNC_JOB } from "@/lib/jobs/handlers/meta-ads-sync";

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

  const due = (workspaces ?? []).filter((w) => isSyncHour(now, w.timezone || "America/Costa_Rica"));
  if (due.length === 0) {
    return NextResponse.json({ ok: true, queued: 0, skipped: "no es la hora de ningun workspace" });
  }

  let queued = 0;

  for (const workspace of due) {
    const { data: accounts } = await supabase
      .from("social_accounts")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("is_active", true);

    for (const account of accounts ?? []) {
      try {
        await scheduleJob(
          supabase,
          METRICS_SYNC_JOB,
          { workspaceId: workspace.id, socialAccountId: account.id },
          now,
          // La clave de dedupe evita que dos corridas del cron encolen la
          // misma cuenta dos veces: con una pendiente, el insert falla.
          `metrics:${account.id}:${now.toISOString().slice(0, 13)}`,
        );
        queued += 1;
      } catch {
        // Ya habia uno pendiente para esta cuenta y esta hora: es el
        // comportamiento que se busca, no un error.
      }
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

  return NextResponse.json({ ok: true, queued, workspaces: due.length });
}
