import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";

/** Tipo de job de un turno del agente conversacional (Fase 3). */
export const AGENT_BURST_JOB = "agent_burst";

/** Tipo de job del cierre de una conversacion: resumen + clasificacion (F33, F34). */
export const CONVERSATION_CLOSE_JOB = "conversation_close";

export interface ConversationClosePayload {
  workspaceId: string;
  conversationId: string;
  /** Como se cerro: el barrido de inactividad o una persona desde la bandeja. */
  trigger: "cron_close" | "manual";
}

/** Anticipacion con la que se agenda un turno: un tic del cron del agente (00063). */
export const AGENT_CRON_TICK_SECONDS = 15;

export interface AgentBurstPayload {
  workspaceId: string;
  conversationId: string;
  channelId: string;
  contactId: string;
  agentId: string;
  /** Instante del ultimo mensaje que reprogramo la ventana. */
  last_message_at: string;
  /** Tope de espera de la rafaga, congelado en el primer mensaje. null = sin tope. */
  burst_deadline?: string | null;
}

/**
 * Cuando tiene que correr el turno del agente para una ventana de silencio.
 *
 * El envio apunta a un objetivo absoluto (ultimo mensaje + ventana + demora)
 * y el turno espera en proceso lo que falte. Por eso el job se agenda UN TIC
 * ANTES de que cierre la ventana: asi el cron cada 15 s lo levanta a tiempo y
 * la espera absorbe el azar del tic. Pura.
 */
export function agentBurstTiming(args: {
  lastMessageAt: Date;
  bundleWindowSeconds: number;
  maxWaitSeconds: number | null;
  now: Date;
}): { runAt: Date; deadline: Date | null } {
  const windowEnd = args.lastMessageAt.getTime() + args.bundleWindowSeconds * 1000;
  const runAt = new Date(Math.max(args.now.getTime(), windowEnd - AGENT_CRON_TICK_SECONDS * 1000));
  const deadline =
    args.maxWaitSeconds === null
      ? null
      : new Date(args.now.getTime() + args.maxWaitSeconds * 1000 - AGENT_CRON_TICK_SECONDS * 1000);
  return { runAt, deadline };
}

/**
 * Agenda o empuja hacia adelante el turno del agente de una conversacion
 * (push_debounced_job, 00061). Atomico: dos mensajes a la vez no crean dos
 * turnos. Si el turno anterior ya esta generando, abre una ventana nueva.
 */
export async function pushDebouncedJob(
  service: SupabaseClient<Database>,
  args: {
    type: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
    runAt: Date;
    deadline: Date | null;
  },
): Promise<{ jobId: string; runAt: string; created: boolean }> {
  const { data, error } = await service.rpc("push_debounced_job", {
    p_type: args.type,
    p_dedupe_key: args.dedupeKey,
    p_payload: args.payload as unknown as Json,
    p_run_at: args.runAt.toISOString(),
    p_deadline: args.deadline ? args.deadline.toISOString() : null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error("push_debounced_job no devolvio el job");
  return { jobId: row.job_id, runAt: row.job_run_at, created: row.created };
}

export function agentBurstKey(conversationId: string): string {
  return `${AGENT_BURST_JOB}:${conversationId}`;
}

/**
 * Agenda un job.
 *
 * `service` TIENE que ser un service client: scheduled_jobs es una cola interna
 * y quedo cerrada a service role en la migracion 00046.
 */
export async function scheduleJob(
  service: SupabaseClient<Database>,
  type: string,
  payload: Record<string, unknown>,
  runAt: Date
) {
  const { data, error } = await service
    .from("scheduled_jobs")
    .insert({
      type,
      payload: payload as unknown as Json,
      run_at: runAt.toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Agenda la entrega de un broadcast, un job por destinatario, espaciados 100ms
 * para no chocar con los limites de la plataforma.
 *
 * Dos clientes a proposito. Los jobs van con service role porque scheduled_jobs
 * es una cola interna y quedo cerrada en la migracion 00046; el estado del
 * broadcast se escribe con el cliente del usuario, para que la RLS siga siendo
 * la que valida que ese broadcast es de su workspace.
 *
 * Los parametros van con nombre y no posicionales porque los dos clientes son
 * del mismo tipo: invertidos, TypeScript no diria nada y el bug resultante
 * seria exactamente el que esta separacion viene a arreglar.
 */
export async function scheduleBroadcastDelivery({
  userClient,
  serviceClient,
  broadcastId,
  recipientIds,
}: {
  userClient: SupabaseClient<Database>;
  serviceClient: SupabaseClient<Database>;
  broadcastId: string;
  recipientIds: string[];
}) {
  if (recipientIds.length === 0) {
    throw new Error("No recipients to schedule");
  }

  const jobs = recipientIds.map((recipientId, index) => ({
    type: "send_broadcast",
    payload: { broadcastId, recipientId } as unknown as Json,
    run_at: new Date(Date.now() + index * 100).toISOString(),
    status: "pending" as const,
  }));

  // Los jobs primero y el estado despues: si esto falla a mitad de camino, un
  // broadcast en borrador con jobs agendados es un estado visible y
  // recuperable; uno en "enviando" sin jobs se cuelga sin ninguna senal.
  const batchSize = 100;
  for (let i = 0; i < jobs.length; i += batchSize) {
    const batch = jobs.slice(i, i + batchSize);
    const { error } = await serviceClient.from("scheduled_jobs").insert(batch);
    if (error) throw new Error(`Failed to schedule jobs: ${error.message}`);
  }

  await userClient
    .from("broadcasts")
    .update({
      status: "sending",
      total_recipients: recipientIds.length,
    })
    .eq("id", broadcastId);
}
