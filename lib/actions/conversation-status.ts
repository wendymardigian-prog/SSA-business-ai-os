"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { enqueueConversationClose } from "@/lib/agent/closing";
import { discardPendingDrafts } from "@/lib/agent/drafts/lifecycle";
import { AUTO_DISCARD } from "@/lib/agent/drafts/types";
import { clearNeedsHuman } from "@/lib/agent/needs-human";

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

  // Cerrar es decidir que no hace falta responder: el borrador pendiente, si
  // habia, sale de la cola (Bloque 2c).
  await discardPendingDrafts(supabase, conversationId, { reason: AUTO_DISCARD.conversationClosed, decidedBy: user.id });

  const service = await createServiceClient();
  await enqueueConversationClose(service, { workspaceId: updated[0].workspace_id, conversationId, trigger: "manual" });

  revalidatePath("/dashboard/inbox");
  return { ok: true };
}

/**
 * "Ya lo vi": limpia la marca de "necesita humano" sin responder (F11).
 *
 * Existe porque no todo escalado necesita una respuesta: si el lead mando una
 * ubicacion o un contacto, con verlo alcanza. Si hubiera que responder para
 * limpiar la marca, la bandeja se llenaria de badges rojos que nadie puede
 * sacar.
 *
 * NO prende el agente de vuelta: apagarlo en esa conversacion fue una decision
 * del sistema, y volver a prenderlo es una decision de la persona, con el
 * interruptor que ya existe en el encabezado del hilo.
 *
 * El update va con el cliente del USUARIO: la RLS aplica el scope de leads, asi
 * que un Member solo puede resolver las conversaciones que le corresponden.
 */
export async function resolveNeedsHuman(
  conversationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof conversationId !== "string" || !conversationId) return { ok: false, error: "Pedido invalido." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesion vencio. Volve a entrar." };

  const { data: conversation, error: readError } = await supabase
    .from("conversations")
    .select("id, workspace_id, needs_human")
    .eq("id", conversationId)
    .is("deleted_at", null)
    .maybeSingle();

  // Sin fila puede ser que no exista o que la RLS no la deje ver: para quien
  // pregunta es lo mismo, y no se confirma que exista.
  if (readError || !conversation) {
    return { ok: false, error: "No encontré esa conversación." };
  }

  if (!conversation.needs_human) {
    // Alguien mas la resolvio mientras esta pantalla estaba abierta. No es un
    // error: el resultado es el que se pedia.
    revalidatePath("/dashboard/inbox");
    return { ok: true };
  }

  const cleared = await clearNeedsHuman(supabase, {
    workspaceId: conversation.workspace_id,
    conversationId,
    userId: user.id,
  });

  if (!cleared) return { ok: false, error: "No pude marcarla como vista. Probá de nuevo." };

  revalidatePath("/dashboard/inbox");
  return { ok: true };
}
