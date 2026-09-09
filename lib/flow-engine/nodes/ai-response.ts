import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { FlowExecutionContext, AiResponseNodeData } from "../types";
import { generateText } from "ai";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { sendChannelMessage, recordSend } from "../send";

/**
 * Corta la corrida.
 *
 * Seguir seria peor que frenar: un Send Message aguas abajo le entregaria al
 * lead el texto literal "{{ai_response}}". Misma pausa que el nodo de
 * derivacion, pero la sesion queda cancelada, no completada.
 */
async function cancelRun(
  supabase: SupabaseClient<Database>,
  sessionId: string
): Promise<"pause"> {
  await supabase.from("flow_sessions").update({ status: "cancelled" }).eq("id", sessionId);
  return "pause";
}

/**
 * Deja registrado por que no se pudo generar la respuesta.
 *
 * Va a analytics_events para que quede la traza, y a la conversacion para que
 * el operador vea que paso sin tener que mirar logs. Nunca se guarda el error
 * crudo del proveedor: puede traer fragmentos del prompt.
 */
async function recordFailure(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext,
  reason: string,
  message: string
): Promise<void> {
  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "ai_response_failed",
    metadata: { reason, message },
  });

  await supabase.from("messages").insert({
    conversation_id: context.conversationId,
    direction: "outbound",
    text: message,
    sent_by_flow_id: context.flowId,
    status: "failed",
  });
}

async function executeAiResponse(
  supabase: SupabaseClient<Database>,
  data: AiResponseNodeData,
  context: FlowExecutionContext,
  sessionId: string
) {
  // La key sale de Vault via integration_configs. Nunca llega hasta aca: lo
  // que vuelve es un modelo ya instanciado.
  const resolved = await getWorkspaceModel(context.workspaceId, {
    preferredProvider: data.provider,
    modelId: data.model,
    supabase,
  });

  if (!resolved.ok || !resolved.model) {
    // Falta la key o el proveedor: no es un error del flow, es configuracion.
    // Se avisa claro y se corta, sin romper nada mas.
    await recordFailure(
      supabase,
      context,
      resolved.problem ?? "no_provider",
      resolved.message ?? "No hay un proveedor de IA disponible."
    );
    return cancelRun(supabase, sessionId);
  }

  // Historial de la conversacion, del mas viejo al mas nuevo.
  const contextMessages = data.contextMessages || 10;
  const { data: recentMessages } = await supabase
    .from("messages")
    .select("direction, text")
    .eq("conversation_id", context.conversationId)
    .order("created_at", { ascending: false })
    .limit(contextMessages);

  const aiMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const msg of [...(recentMessages ?? [])].reverse()) {
    if (!msg.text) continue;
    aiMessages.push({
      role: msg.direction === "inbound" ? "user" : "assistant",
      content: msg.text,
    });
  }

  let text: string;
  try {
    const result = await generateText({
      model: resolved.model,
      system: data.systemPrompt || "Sos un asistente de atencion al cliente. Responde en español rioplatense, breve y claro.",
      messages: aiMessages,
      temperature: data.temperature ?? 0.7,
      maxOutputTokens: data.maxTokens ?? 500,
    });
    text = result.text;
  } catch (error) {
    // Key invalida, cuota agotada, modelo inexistente, corte de red. El detalle
    // va al log del servidor; a la conversacion va algo legible.
    console.error(
      `[ai] fallo la generacion con ${resolved.provider}/${resolved.modelId}:`,
      error instanceof Error ? error.message : "error desconocido"
    );
    await recordFailure(
      supabase,
      context,
      "generation_failed",
      "No se pudo generar la respuesta con IA. Conviene revisar que la API key del proveedor siga siendo valida y tenga saldo."
    );
    return cancelRun(supabase, sessionId);
  }

  // Queda disponible para los nodos siguientes como {{ai_response}}.
  context.variables = { ...(context.variables ?? {}), ai_response: text };

  // Traza de la ejecucion. Sin el prompt ni la respuesta: el conteo fino de
  // tokens es Fase 3, esto es para saber que corrio y con que.
  await supabase.from("analytics_events").insert({
    workspace_id: context.workspaceId,
    flow_id: context.flowId,
    contact_id: context.contactId,
    event_type: "ai_response_generated",
    metadata: {
      provider: resolved.provider,
      model: resolved.modelId,
      chars: text.length,
      contextMessages: aiMessages.length,
    },
  });

  if (data.sendDirectly !== false) {
    const outcome = await sendChannelMessage(supabase, context, { text });
    await recordSend(
      supabase,
      context,
      outcome.ok ? text : outcome.failure?.message ?? text,
      outcome
    );
    // Si el envio fallo, el texto igual quedo en {{ai_response}} y el flow
    // puede seguir (por ejemplo, para derivar a una persona). Solo se cancela
    // cuando falla la generacion, que es cuando no hay nada que decir.
  }
}

/**
 * Genera una respuesta con IA y, si esta configurado asi, la manda.
 *
 * Es una respuesta puntual adentro de un flow, no el agente conversacional en
 * loop: eso es la Fase 3.
 */
export const aiResponseNode: NodeDefinition<AiResponseNodeData> = {
  type: "aiResponse",
  label: "Respuesta con IA",
  persistsVariables: true,
  execute: ({ supabase, data, context, sessionId }: NodeExecutionArgs<AiResponseNodeData>) =>
    executeAiResponse(supabase, data, context, sessionId),
};
