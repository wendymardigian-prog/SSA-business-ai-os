/**
 * Las publicaciones que suben el archivo desde aca (A17).
 *
 * Una sola razon para existir: subir un video a YouTube por trozos puede
 * tardar minutos. Dentro del cron general esos minutos se los come la cola
 * entera —los jobs que venian detras esperan— y encima esa ruta no tiene
 * limite de tiempo declarado, asi que la corrida se puede cortar a la mitad
 * de la subida.
 *
 * Aca corre de a una, con cinco minutos de margen, y no le saca el turno a
 * nadie.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { CONTENT_UPLOAD_JOB } from "@/lib/content/jobs";
import { getJobHandler } from "@/lib/jobs/registry";
import { registerPublishing } from "@/lib/publishing/bootstrap";

registerPublishing();

export const maxDuration = 300;

/** Cuantas subidas por corrida. Una por vez: son largas por definicion. */
const BATCH = 1;

/** Un claim viejo es de una corrida que murio: se puede volver a tomar. */
const STALE_CLAIM_MS = 10 * 60_000;

const MAX_ATTEMPTS = 3;

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = await createServiceClient();
  const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

  const { data: jobs, error } = await supabase
    .from("scheduled_jobs")
    .select("*")
    .eq("type", CONTENT_UPLOAD_JOB)
    .or(
      `status.eq.pending,and(status.eq.processing,or(claimed_at.lt.${staleCutoff},claimed_at.is.null))`,
    )
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error("[cron/content-upload] no pude leer la cola:", error.message);
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
  }

  let processed = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    // El mismo claim que el cron general: si el UPDATE no toca ninguna fila,
    // otra corrida se lo llevo y este no lo toca.
    const { data: claimed } = await supabase
      .from("scheduled_jobs")
      .update({ status: "processing", claimed_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", job.status)
      .select("id")
      .maybeSingle();

    if (!claimed) continue;

    const handler = getJobHandler(CONTENT_UPLOAD_JOB);
    if (!handler) {
      await supabase
        .from("scheduled_jobs")
        .update({ status: "failed", error: "sin handler de subida" })
        .eq("id", job.id);
      failed++;
      continue;
    }

    try {
      await handler({ supabase, job: { ...job, attempts: job.attempts ?? 0 } });
      await supabase
        .from("scheduled_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", job.id);
      processed++;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const attempts = (job.attempts ?? 0) + 1;
      failed++;
      console.error(`[cron/content-upload] job ${job.id}:`, detail);

      await supabase
        .from("scheduled_jobs")
        .update(
          attempts >= MAX_ATTEMPTS
            ? { status: "failed", attempts, error: detail }
            : {
                status: "pending",
                attempts,
                error: detail,
                claimed_at: null,
                // Espera creciente: si YouTube esta caido, insistir cada
                // minuto no ayuda.
                run_at: new Date(Date.now() + attempts * 5 * 60_000).toISOString(),
              },
        )
        .eq("id", job.id);
    }
  }

  return NextResponse.json({ ok: true, processed, failed });
}
