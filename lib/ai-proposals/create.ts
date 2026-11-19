import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { createNotificationOnce } from "@/lib/notifications/create";
import type { ProposalExecutor } from "./types";

/**
 * Deja una propuesta pendiente. Siempre con el cliente de servicio, DESPUÉS de que quien llama comprobó lo
 * suyo. Nunca lanza: si no se puede guardar, devuelve null y la herramienta le dice al modelo que no pudo (nunca
 * ejecuta «por las dudas»).
 */
export interface CreateProposalInput {
  workspaceId: string;
  executor: ProposalExecutor;
  agentId: string | null;
  runId: string | null;
  requestedBy?: string | null;
  channelId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  toolKey: string;
  label: string;
  summary?: string | null;
  params: unknown;
  /** La configuración de la herramienta (agent_tool). No viaja al navegador. */
  toolConfig?: unknown;
}

export async function createProposal(service: SupabaseClient<Database>, input: CreateProposalInput): Promise<{ id: string } | null> {
  try {
    const { data, error } = await service
      .from("ai_proposals")
      .insert({
        workspace_id: input.workspaceId,
        agent_id: input.agentId,
        run_id: input.runId,
        requested_by: input.requestedBy ?? null,
        channel_id: input.channelId ?? null,
        conversation_id: input.conversationId ?? null,
        subject_type: input.contactId ? "contact" : null,
        subject_id: input.contactId ?? null,
        kind: "action",
        tool_key: input.toolKey,
        label: input.label.slice(0, 200) || input.toolKey,
        summary: input.summary ? input.summary.slice(0, 1000) : null,
        params_proposed: (input.params ?? {}) as Json,
        tool_config: { executor: input.executor, config: (input.toolConfig ?? {}) as Json } as Json,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("[ai-proposals] no pude guardar la propuesta:", error?.code ?? "?", error?.message);
      return null;
    }
    // Aviso a quien puede aprobar (campana), uno cada 30 minutos mientras siga sin leer.
    await createNotificationOnce({
      supabase: service,
      workspaceId: input.workspaceId,
      type: "ai_proposal_pending",
      title: "Hay propuestas de la IA para aprobar",
      body: "Un agente dejó una acción pendiente. Nada se aplica hasta que una persona la apruebe.",
      recipientId: input.requestedBy ?? null,
      metadata: { proposal_id: data.id, tool: input.toolKey },
      withinMinutes: 30,
      perRecipient: Boolean(input.requestedBy),
    });
    return { id: data.id };
  } catch (err) {
    console.error("[ai-proposals] no pude guardar la propuesta:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
