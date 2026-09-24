"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { enqueueConversationClose } from "@/lib/agent/closing";

/**
 * Cerrar una conversacion desde la bandeja (F33/F34).
 *
 * Antes era un update desde el navegador. Ahora pasa por aca para que el
 * cierre encole el job de resumen y clasificacion. El update va con el cliente
 * del usuario (la RLS aplica el scope de leads); el job, con service role
 * (scheduled_jobs es una cola interna).
 *
 * Cerrar borra tambien la marca de error del agente: "ya me hice cargo".
 */
export async function closeConversation(conversationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof conversationId !== "string" || !conversationId) return { ok: false, error: "Pedido invalido." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesion vencio. Volve a entrar." };

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("conversations")
    .update({ status: "closed", closed_at: now, last_agent_error_at: null, last_agent_error_run_id: null })
    .eq("id", conversationId)
    .is("deleted_at", null)
    .select("id, workspace_id");
  if (error || !updated?.length) {
    console.error("[conversation-status] no pude cerrar:", error?.message ?? "sin filas");
    return { ok: false, error: "No pude cerrar la conversación. Probá de nuevo." };
  }

  const service = await createServiceClient();
  await enqueueConversationClose(service, { workspaceId: updated[0].workspace_id, conversationId, trigger: "manual" });

  revalidatePath("/dashboard/inbox");
  return { ok: true };
}
