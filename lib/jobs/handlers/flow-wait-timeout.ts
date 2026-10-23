/**
 * El vencimiento de un "Esperar respuesta" (auditoria de automatizaciones, oct 2026).
 *
 * Lo agenda el nodo al pausar. Cuando llega la hora:
 *  - si la sesion ya no espera en ESE paso (el contacto respondio, o se cancelo), no hace nada;
 *  - `timeout`: retoma por la salida "Si no responde a tiempo" (o la de siempre, si esa no esta conectada);
 *  - `expire` (sin tiempo maximo): la cierra sin seguir, para que una respuesta de semanas despues no quede tragada.
 *
 * Retomar es un reclamo sobre `waiting_for_input` (ver `resumeSession`): si la respuesta del contacto llega en el mismo
 * momento, sigue uno solo de los dos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { expireWaitingSession, resumeSession } from "@/lib/flow-engine/engine";
import { FLOW_WAIT_TIMEOUT_JOB } from "@/lib/flow-engine/nodes/delay";

type Db = SupabaseClient<Database>;

export interface FlowWaitTimeoutPayload {
  sessionId: string;
  nodeId: string;
  exit: "timeout" | "expire";
  flowId: string;
  channelId: string;
  contactId: string | null;
  conversationId: string;
  workspaceId: string;
  lateConversationId?: string | null;
  lateAccountId?: string | null;
}

export async function handleFlowWaitTimeout(ctx: JobContext): Promise<void> {
  const supabase = ctx.supabase as Db;
  const payload = ctx.job.payload as FlowWaitTimeoutPayload | null;
  if (!payload?.sessionId || !payload.nodeId) return;

  const { data: session, error } = await supabase
    .from("flow_sessions")
    .select("*")
    .eq("id", payload.sessionId)
    .eq("status", "active")
    .eq("waiting_for_input", true)
    .eq("current_node_id", payload.nodeId)
    .maybeSingle();
  if (error) throw new Error(`no pude leer la sesion ${payload.sessionId}: ${error.message}`);
  // Ya respondio, se cancelo o siguio de largo: el vencimiento no tiene nada que hacer.
  if (!session) return;

  if (payload.exit === "expire") {
    await expireWaitingSession(supabase, session.id, payload.nodeId);
    return;
  }

  await resumeSession(
    supabase,
    session,
    {
      triggerId: "",
      flowId: session.flow_id,
      channelId: payload.channelId ?? session.channel_id ?? "",
      contactId: payload.contactId ?? session.contact_id,
      conversationId: payload.conversationId ?? "",
      workspaceId: payload.workspaceId,
      lateConversationId: payload.lateConversationId || undefined,
      lateAccountId: payload.lateAccountId || undefined,
      incomingMessage: {},
    },
    "timeout",
  );
}

export function registerFlowWaitTimeoutHandler(): void {
  registerJobHandler(FLOW_WAIT_TIMEOUT_JOB, handleFlowWaitTimeout);
}
