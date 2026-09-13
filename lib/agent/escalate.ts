import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";

/**
 * Derivar la conversacion a una persona (Human Takeover desde el agente).
 *
 * Es la salida de emergencia de todo el motor: la usan la herramienta del
 * agente, los guardarrailes que derivan y el fallo del proveedor despues del
 * respaldo. Hace siempre lo mismo, en este orden:
 *
 *   1. Apaga el agente en la conversacion y pausa las automatizaciones. Va
 *      primero: si algo de lo que sigue falla, la conversacion igual queda en
 *      manos de una persona, que es lo que importa.
 *   2. Deja el efecto de negocio en el audit_log, con el agente como actor.
 *   3. Avisa en la campana con un resumen del contexto.
 *
 * Nunca manda nada al lead. Si hay que avisarle algo, lo decide quien llama.
 */

type Db = SupabaseClient<Database>;

export interface EscalateArgs {
  workspaceId: string;
  conversationId: string;
  contactId: string | null;
  channelId: string | null;
  agentId: string;
  runId: string | null;
  /** Por que se deriva, en una linea. Queda en el audit y en el aviso. */
  reason: string;
  /** Resumen del contexto para quien toma la conversacion. */
  summary?: string | null;
  /** Origen, para distinguir en el audit: la herramienta, un guardarrail o un fallo. */
  origin: "tool" | "guardrail" | "provider_failure";
  /** Si ademas se reabre la conversacion (status open). */
  reopen?: boolean;
}

const MAX_SUMMARY = 400;

export async function escalateToHuman(
  supabase: Db,
  args: EscalateArgs,
): Promise<{ auditLogId: string | null }> {
  const { data: before } = await supabase
    .from("conversations")
    .select("agent_enabled, is_automation_paused, status, assigned_to")
    .eq("id", args.conversationId)
    .maybeSingle();

  const update: Database["public"]["Tables"]["conversations"]["Update"] = {
    agent_enabled: false,
    is_automation_paused: true,
  };
  if (args.reopen) update.status = "open";

  const { error } = await supabase.from("conversations").update(update).eq("id", args.conversationId);
  if (error) console.error("[agent-escalate] no pude pausar la conversacion:", error.message);

  const summary = args.summary ? args.summary.trim().slice(0, MAX_SUMMARY) : null;

  const auditLogId = await logAudit({
    supabase,
    workspaceId: args.workspaceId,
    entityType: "conversation",
    entityId: args.conversationId,
    action: "human_takeover",
    changes: {
      agent_enabled: { old: before?.agent_enabled ?? null, new: false },
      is_automation_paused: { old: before?.is_automation_paused ?? null, new: true },
      ...(args.reopen ? { status: { old: before?.status ?? null, new: "open" } } : {}),
    },
    metadata: {
      origin: args.origin,
      reason: args.reason,
      run_id: args.runId,
      contact_id: args.contactId,
      channel_id: args.channelId,
    },
    performedByAgentId: args.agentId,
  });

  const { data: contact } = args.contactId
    ? await supabase
        .from("contacts")
        .select("display_name, instagram_username")
        .eq("id", args.contactId)
        .maybeSingle()
    : { data: null };
  const who = contact?.display_name || (contact?.instagram_username ? `@${contact.instagram_username}` : "Un contacto");

  await createNotification({
    supabase,
    workspaceId: args.workspaceId,
    type: "human_takeover",
    title: `${who} necesita una persona`,
    body: summary ? `${args.reason}. ${summary}` : args.reason,
    entityType: "conversation",
    entityId: args.conversationId,
    recipientId: before?.assigned_to ?? null,
    metadata: { run_id: args.runId, origin: args.origin, contact_id: args.contactId, channel_id: args.channelId },
  });

  return { auditLogId };
}
