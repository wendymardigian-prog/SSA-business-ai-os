"use server";

import { createClient } from "@/lib/supabase/server";
import { AGENT_ACTION_LABELS } from "@/lib/agent/action-labels";
import type { AuditAction } from "@/lib/types/database";
import type { ActivityAction, ActivityDraft, ActivityRun } from "@/lib/inbox/message-activity";

/**
 * Lo que hizo el agente en una conversacion (A1.2): corridas, borradores y
 * acciones, para armar la historia de cada mensaje (`buildActivity`).
 *
 * Se lee con el cliente del USUARIO: la RLS de cada tabla decide que ve (un
 * Member solo ve lo de sus conversaciones). Nunca `select("*")` sobre
 * `agent_runs`: tiene columnas de costo sin permiso de lectura; solo las
 * publicas. Un fallo devuelve vacio: la bandeja funciona igual sin indicadores.
 */

export interface ConversationActivityData {
  runs: ActivityRun[];
  drafts: ActivityDraft[];
  actions: ActivityAction[];
}

const EMPTY: ConversationActivityData = { runs: [], drafts: [], actions: [] };

export async function loadConversationActivity(conversationId: string): Promise<ConversationActivityData> {
  if (typeof conversationId !== "string" || !conversationId) return EMPTY;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return EMPTY;

  const [runs, drafts, actions] = await Promise.all([
    supabase
      .from("agent_runs")
      .select("id, source, trigger, status, status_detail, created_at, inbound_at, responded_at, completed_at")
      .eq("conversation_id", conversationId)
      .eq("source", "agent")
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("agent_drafts")
      .select("id, run_id, status, created_at, decided_at, discard_reason, body, no_reply_reason")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("audit_log")
      .select("id, action, performed_at, metadata")
      .not("performed_by_agent_id", "is", null)
      .contains("metadata", { conversation_id: conversationId })
      .in("action", Object.keys(AGENT_ACTION_LABELS) as AuditAction[])
      .order("performed_at", { ascending: false })
      .limit(120),
  ]);

  if (runs.error) console.error("[activity] no pude leer las corridas:", runs.error.message);
  if (drafts.error) console.error("[activity] no pude leer los borradores:", drafts.error.message);
  if (actions.error) console.error("[activity] no pude leer las acciones:", actions.error.message);

  return {
    runs: (runs.data ?? []) as ActivityRun[],
    drafts: (drafts.data ?? []).map((d) => ({
      id: d.id,
      run_id: d.run_id,
      status: d.status,
      created_at: d.created_at,
      decided_at: d.decided_at,
      discard_reason: d.discard_reason,
      has_body: typeof d.body === "string" && d.body.trim() !== "",
      no_reply_reason: d.no_reply_reason,
    })),
    actions: (actions.data ?? []).map((a) => {
      const meta = a.metadata && typeof a.metadata === "object" && !Array.isArray(a.metadata) ? (a.metadata as Record<string, unknown>) : {};
      return { id: a.id, action: a.action, performed_at: a.performed_at, run_id: typeof meta.run_id === "string" ? meta.run_id : null };
    }),
  };
}
