/**
 * Puertas de arranque de triggers (Fase 3).
 *
 * Se prenden desde la config de cualquier trigger y se evaluan en el matcher
 * despues del match. Sumar una puerta es una entrada aca.
 */

import { registerTriggerGuard } from "./registry";
import { agentStateForConversation } from "@/lib/agent/state";

/**
 * "Solo si el agente de IA esta apagado en esta conversacion."
 *
 * Es la herramienta para convivir con el agente: un flow con trigger por
 * defecto reclama TODOS los mensajes, y como la automatizacion tiene prioridad,
 * el agente nunca contestaria. Con esta puerta prendida, el flow corre en las
 * conversaciones sin agente y le deja al agente las suyas.
 */
registerTriggerGuard({
  configKey: "only_if_agent_off",
  label: "Solo si el agente de IA esta apagado",
  description: "El flow no arranca en las conversaciones que esta atendiendo el agente de IA.",
  allows: async ({ supabase, workspaceId, conversationId }) => {
    const state = await agentStateForConversation(supabase, { workspaceId, conversationId });
    return state.state !== "active";
  },
});
