import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { todayInputValue } from "@/lib/dates";
import { createTaskFromAutomation, resolveConversationResponsible } from "@/lib/tasks/create-from-automation";

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
  /**
   * Origen, para distinguir en el audit: la herramienta, un guardarrail, un
   * fallo, o una persona que aprobo un borrador que sugeria derivar (2c).
   */
  origin: "tool" | "guardrail" | "provider_failure" | "draft_approval";
  /** Metadata extra para el audit (en draft_approval: approved_by, draft_id). */
  extraMeta?: Record<string, string | null>;
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
      ...(args.extraMeta ?? {}),
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

  // Opcional y apagado por defecto (Tareas, F24): ademas de avisar, deja una tarea. No cambia nada de lo de arriba.
  await maybeCreateEscalationTask(supabase, args, { who, summary });

  return { auditLogId };
}

/**
 * «Crear una tarea cuando derive a una persona» (F24). Si el agente lo tiene prendido, deja una tarea `agent` vinculada a
 * la conversacion, a cargo de quien tiene la conversacion (asignada, setter o vendedor; si nadie, avisa a Owner/Admin).
 * NUNCA lanza ni frena el escalamiento: ya estan hechos el apagado, el audit y el aviso.
 */
async function maybeCreateEscalationTask(supabase: Db, args: EscalateArgs, ctx: { who: string; summary: string | null }): Promise<void> {
  try {
    const { data: agent } = await supabase.from("agents").select("guardrails").eq("id", args.agentId).maybeSingle();
    const escalation = (agent?.guardrails as { escalation?: { createTaskOnEscalate?: unknown } } | null)?.escalation;
    if (escalation?.createTaskOnEscalate !== true) return;

    const { data: workspace } = await supabase.from("workspaces").select("timezone").eq("id", args.workspaceId).maybeSingle();
    const ownerId = await resolveConversationResponsible(supabase, { workspaceId: args.workspaceId, conversationId: args.conversationId, contactId: args.contactId });
    await createTaskFromAutomation(supabase, {
      workspaceId: args.workspaceId,
      title: `Atender a ${ctx.who}: pidió una persona`,
      description: ctx.summary ? `${args.reason}. ${ctx.summary}` : args.reason,
      priority: "high",
      dueDate: todayInputValue(new Date(), workspace?.timezone || "UTC"),
      ownerId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      source: "agent",
      // Una por derivacion: si el mismo turno deriva dos veces, la tarea abierta es una sola.
      sourceRef: `escalation:${args.runId ?? args.conversationId}:${args.conversationId}`,
      actor: { kind: "agent", label: "Agente de IA", agentId: args.agentId, runId: args.runId, origin: "escalation" },
      notifyIfUnassigned: true,
      reason: args.reason,
    });
  } catch (error) {
    console.error("[tareas] no pude crear la tarea al derivar:", error instanceof Error ? error.message : String(error));
  }
}
