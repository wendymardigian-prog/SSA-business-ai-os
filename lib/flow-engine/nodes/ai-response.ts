import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { FlowExecutionContext, AiResponseNodeData } from "../types";
import { generateAiReply } from "@/lib/ai/generate-reply";
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

async function executeAiResponse(
  supabase: SupabaseClient<Database>,
  data: AiResponseNodeData,
  context: FlowExecutionContext,
  sessionId: string
) {
  // La generacion (BYOK, historial, traza) vive en lib/ai/generate-reply.ts,
  // que es lo mismo que usan los pasos de IA de las secuencias. Lo que sigue
  // siendo de este nodo es la politica de fallo: en un flow, no poder generar
  // significa cancelar la corrida.
  const reply = await generateAiReply(supabase, {
    workspaceId: context.workspaceId,
    conversationId: context.conversationId,
    contactId: context.contactId,
    provider: data.provider,
    modelId: data.model,
    systemPrompt: data.systemPrompt,
    temperature: data.temperature,
    maxTokens: data.maxTokens,
    contextMessages: data.contextMessages,
    trace: { source: "flow", flowId: context.flowId },
  });

  if (!reply.ok) {
    // Falta la key, es invalida o el proveedor fallo: no es un error del flow,
    // es configuracion. Se avisa en la conversacion para que el operador lo vea
    // sin mirar logs, y se corta sin romper nada mas.
    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text: reply.message,
      sent_by_flow_id: context.flowId,
      status: "failed",
    });
    return cancelRun(supabase, sessionId);
  }

  // Queda disponible para los nodos siguientes como {{ai_response}}.
  context.variables = { ...(context.variables ?? {}), ai_response: reply.text };

  if (data.sendDirectly !== false) {
    const outcome = await sendChannelMessage(supabase, context, { text: reply.text });
    await recordSend(
      supabase,
      context,
      outcome.ok ? reply.text : outcome.failure?.message ?? reply.text,
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
