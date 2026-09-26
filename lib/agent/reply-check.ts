import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/**
 * ¿Ya hubo una respuesta después del inbound del turno? (F5, momento 1).
 *
 * "Ya respondida" = existe un saliente de la conversación con created_at >
 * inboundAt, que no falló, y que no es el propio envío de este turno
 * (agent_run_id = exceptRunId). Al momento 1 exceptRunId es null (todavía no
 * hay envío propio), así que cuenta cualquier saliente: agente, persona, flow o
 * external (ManyChat, recién traído por el refresco).
 *
 * El momento 2 usa el RPC claim_agent_reply (con lock); este helper es la
 * versión de sólo lectura del momento 1.
 */
export async function alreadyAnsweredSince(
  supabase: Db,
  args: { conversationId: string; inboundAt: string; exceptRunId?: string | null },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, agent_run_id, status")
    .eq("conversation_id", args.conversationId)
    .eq("direction", "outbound")
    .gt("created_at", args.inboundAt)
    .neq("status", "failed")
    .limit(20);
  if (error) {
    console.error("[reply-check] no pude mirar si ya respondieron:", error.message);
    return false;
  }
  const rows = (data ?? []) as Array<{ agent_run_id: string | null }>;
  return rows.some((r) => !args.exceptRunId || r.agent_run_id !== args.exceptRunId);
}

/**
 * El instante del saliente externo más reciente de la conversación (F7). null
 * si no hay ninguno. Se usa para la espera tras respuesta externa.
 */
export async function lastExternalOutboundAt(
  supabase: Db,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .eq("origin", "external")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[reply-check] no pude mirar el último saliente externo:", error.message);
    return null;
  }
  return (data as { created_at?: string } | null)?.created_at ?? null;
}

/**
 * Decide la espera tras respuesta externa (F7): true si hay que abstenerse.
 * Puro para poder testearlo sin base.
 */
export function withinExternalCooldown(args: {
  lastInboundAt: string;
  lastExternalAt: string | null;
  cooldownMinutes: number;
}): boolean {
  if (args.cooldownMinutes <= 0 || !args.lastExternalAt) return false;
  const inbound = new Date(args.lastInboundAt).getTime();
  const external = new Date(args.lastExternalAt).getTime();
  return inbound < external + args.cooldownMinutes * 60_000;
}

/**
 * Momento 2 (F5): chequeo atómico bajo advisory lock por conversación (RPC
 * claim_agent_reply). true si ya hubo un saliente posterior al inbound que no
 * es el propio run. Si el RPC falla, cae a la versión de sólo lectura.
 */
export async function claimAgentReply(
  supabase: Db,
  args: { conversationId: string; inboundAt: string; runId: string | null },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_agent_reply", {
    p_conversation_id: args.conversationId,
    p_inbound_at: args.inboundAt,
    p_run_id: args.runId,
  });
  if (error) {
    console.error("[reply-check] claim_agent_reply falló, uso el chequeo simple:", error.message);
    return alreadyAnsweredSince(supabase, {
      conversationId: args.conversationId,
      inboundAt: args.inboundAt,
      exceptRunId: args.runId,
    });
  }
  return Boolean(data);
}
