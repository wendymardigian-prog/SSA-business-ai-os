import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";

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
