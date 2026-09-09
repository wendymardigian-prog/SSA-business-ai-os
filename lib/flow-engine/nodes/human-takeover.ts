import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";

/**
 * Deriva la conversacion a una persona.
 *
 * Pausa la automatizacion de la conversacion y cierra la sesion: a partir de
 * aca contesta alguien del equipo. La marca que deja (is_automation_paused) es
 * la misma que mira runInboundAutomation para no meterse cuando un humano tomo
 * la conversacion.
 */
export const humanTakeoverNode: NodeDefinition<unknown> = {
  type: "humanTakeover",
  label: "Derivar a una persona",
  aliases: [{ nodeType: "action", actionType: "humanTakeover" }],
  async execute({ supabase, context, sessionId }: NodeExecutionArgs<unknown>) {
    await supabase
      .from("conversations")
      .update({ is_automation_paused: true })
      .eq("id", context.conversationId);

    await supabase
      .from("flow_sessions")
      .update({ human_takeover_at: new Date().toISOString(), status: "completed" })
      .eq("id", sessionId);

    return "pause";
  },
};
