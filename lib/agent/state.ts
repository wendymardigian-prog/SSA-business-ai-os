import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { loadWorkspaceAgents, resolveAgentState, type AgentAvailability } from "./config";

/**
 * El estado efectivo del agente en una conversacion, leido de la base.
 *
 * Lo usan los primitivos del flow builder (el guard de trigger y la condicion
 * "el agente esta activo"). Mismo calculo que el despacho y el turno: una sola
 * definicion de "activo".
 */
export async function agentStateForConversation(
  supabase: SupabaseClient<Database>,
  args: { workspaceId: string; conversationId: string; now?: Date },
): Promise<AgentAvailability> {
  const { data: conversation } = await supabase
    .from("conversations")
    .select("channel_id, agent_enabled, agent_paused_until")
    .eq("id", args.conversationId)
    .maybeSingle();
  if (!conversation) return { state: "no_agent" };

  const agents = await loadWorkspaceAgents(supabase, args.workspaceId);
  return resolveAgentState({
    agents,
    channelId: conversation.channel_id,
    conversation,
    now: args.now ?? new Date(),
  });
}
