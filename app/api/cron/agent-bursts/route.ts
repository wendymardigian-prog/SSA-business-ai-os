import { after, NextResponse, type NextRequest } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { AGENT_BURST_JOB } from "@/lib/scheduler";
import { closeStaleRuns, recordRunOutcome } from "@/lib/ai/run";
import { runAgentTurn } from "@/lib/agent/runner";
import { markAgentError } from "@/lib/agent/errors";

/**
 * Turnos del agente conversacional (Fase 3, Bloque 2a).
 *
 * Lo llama pg_cron cada 15 segundos (migracion 00063). Ruta propia y no el
 * runner general de /api/cron/jobs por dos motivos: ese runner procesa 20 jobs
 * por minuto y una tanda de broadcasts podria demorar el turno del agente, y
 * sus reintentos con backoff no sirven aca (una respuesta cinco minutos tarde
 * es peor que ninguna).
 *
 * El trabajo va en after(): el turno espera en proceso hasta el objetivo de
 * envio (ventana + demora) y puede tardar mas que el timeout de 60 s de la
 * llamada de pg_net. Los jobs se RECLAMAN antes de responder, asi el tic
 * siguiente no los vuelve a tomar.
 *
 * Sin reintentos: si un turno se corta, el job queda en processing y el barrido
 * lo descarta con aviso (job vencido) en vez de responder tarde.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_TURNS_PER_TICK = 10;
/** Un job en processing sin terminar despues de esto murio con el proceso. */
const STALE_CLAIM_MS = 6 * 60_000;

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = await createServiceClient();
  const now = new Date();

  // Barridos: runs abiertos de procesos que murieron, y jobs trabados.
  const staleRuns = await closeStaleRuns(supabase, { now });
  for (const stale of staleRuns) {
    if (stale.source === "agent" && stale.conversation_id) {
      await markAgentError(supabase, {
        workspaceId: stale.workspace_id,
        conversationId: stale.conversation_id,
        runId: stale.id,
        kind: "turn_error",
        now,
      });
    }
  }
  await expireStuckJobs(supabase, now);

  const { data: jobs, error } = await supabase
    .from("scheduled_jobs")
    .select("id, payload, attempts, status")
    .eq("type", AGENT_BURST_JOB)
    .eq("status", "pending")
    .lte("run_at", now.toISOString())
    .order("run_at", { ascending: true })
    .limit(MAX_TURNS_PER_TICK);

  if (error) {
    console.error("[cron:agent-bursts] no pude leer los turnos:", error.message);
    return NextResponse.json({ error: "No se pudieron leer los turnos" }, { status: 500 });
  }

  const claimed: Array<{ id: string; payload: unknown }> = [];
  for (const job of jobs ?? []) {
    // CAS: solo uno de los tics solapados se queda con el job.
    const { data: rows, error: claimError } = await supabase
      .from("scheduled_jobs")
      .update({ status: "processing", attempts: job.attempts + 1, claimed_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending")
      .eq("attempts", job.attempts)
      .select("id");
    if (claimError) {
      console.error("[cron:agent-bursts] no pude reclamar un turno:", claimError.message);
      continue;
    }
    if (rows && rows.length > 0) claimed.push({ id: job.id, payload: job.payload });
  }

  after(async () => {
    const service = await createServiceClient();
    await Promise.all(
      claimed.map(async (job) => {
        try {
          const outcome = await runAgentTurn(service, job.payload);
          await service
            .from("scheduled_jobs")
            .update({ status: "completed", last_error: outcome.kind === "run" ? outcome.detail : outcome.reason })
            .eq("id", job.id);
        } catch (err) {
          // runAgentTurn ya cierra el run y marca la conversacion en sus
          // errores; esto es la ultima red por si lanzo antes de abrirlo.
          const message = err instanceof Error ? err.message : "error desconocido";
          console.error("[cron:agent-bursts] el turno lanzo:", message);
          await service.from("scheduled_jobs").update({ status: "failed", last_error: message }).eq("id", job.id);
        }
      }),
    );
  });

  return NextResponse.json(
    { claimed: claimed.length, staleRuns: staleRuns.length },
    { status: claimed.length > 0 ? 202 : 200 },
  );
}

/**
 * Jobs de turno que quedaron en processing mas alla de lo posible: el proceso
 * murio a mitad. No se reintentan: se descartan dejando run, marca y aviso.
 */
async function expireStuckJobs(supabase: Awaited<ReturnType<typeof createServiceClient>>, now: Date) {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const { data: stuck, error } = await supabase
    .from("scheduled_jobs")
    .update({ status: "failed", last_error: "job_expired: el proceso se corto antes de terminar el turno" })
    .eq("type", AGENT_BURST_JOB)
    .eq("status", "processing")
    .lt("claimed_at", cutoff)
    .select("id, payload");
  if (error) {
    console.error("[cron:agent-bursts] no pude barrer turnos trabados:", error.message);
    return;
  }

  for (const job of stuck ?? []) {
    const p = (job.payload ?? {}) as Record<string, string>;
    if (!p.workspaceId || !p.conversationId) continue;

    // Si el turno llego a abrir su run, se cierra ese (un solo run por turno).
    const { data: open } = await supabase
      .from("agent_runs")
      .update({
        status: "error",
        status_detail: "job_expired",
        error: "El turno quedo trabado y se descarto.",
        completed_at: now.toISOString(),
      })
      .eq("conversation_id", p.conversationId)
      .eq("source", "agent")
      .eq("status", "running")
      .select("id");
    const runId = open && open.length > 0 ? open[0].id : await recordRunOutcome(supabase, {
      workspaceId: p.workspaceId,
      source: "agent",
      trigger: "inbound_message",
      agentId: p.agentId ?? null,
      conversationId: p.conversationId,
      contactId: p.contactId ?? null,
      channelId: p.channelId ?? null,
      status: "error",
      statusDetail: "job_expired",
      error: "El turno quedo trabado y se descarto.",
    });
    await markAgentError(supabase, {
      workspaceId: p.workspaceId,
      conversationId: p.conversationId,
      runId,
      kind: "job_expired",
      now,
    });
  }
}
