import "server-only";
import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { findAssistantThread, listMessages } from "@/lib/ai-threads/store";
import { loadProposalStates } from "./turn";
import { canResume, parseAssistantResult, proposalIdsOf, proposalPhase, turnPhase, type AssistantStep, type ProposalPhase, type StoredMessage, type TurnPhase } from "./steps";

/**
 * Quién habla con el asistente: el negocio y la persona salen de la sesión, nunca del navegador. Lo usan las acciones
 * del panel acoplado y la ruta en directo de la pantalla completa.
 */
export async function assistantActor() {
  const ctx = await getMemberAction();
  if (!ctx) return null;
  const service = await createServiceClient();
  return {
    ctx,
    service,
    tool: {
      supabase: ctx.supabase,
      service,
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      actorName: (ctx.user.user_metadata?.full_name as string | undefined) ?? undefined,
      timeZone: ctx.workspace.timezone ?? "UTC",
      can: ctx.can,
    },
  };
}
export type AssistantActor = NonNullable<Awaited<ReturnType<typeof assistantActor>>>;

export interface PanelStep extends AssistantStep {
  proposal?: { phase: ProposalPhase; label: string } | null;
}

export interface PanelMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  steps: PanelStep[];
  error: string | null;
  /** Lo que se propuso hacer. */
  plan: string[];
  phase: TurnPhase;
  /** Se puede seguir desde el paso donde estaba (lo propuesto ya se decidió, o se cortó a mitad). */
  canResume: boolean;
}

/** La conversación tal como está guardada (la pantalla se dibuja desde aquí). Con la sesión: la RLS solo deja SU hilo. */
export async function assistantPanelMessages(a: AssistantActor, now = new Date()): Promise<PanelMessage[]> {
  const thread = await findAssistantThread(a.ctx.supabase, { workspaceId: a.ctx.workspace.id, userId: a.ctx.user.id });
  if (!thread) return [];
  const rows = await listMessages(a.ctx.supabase, thread.id, 200);
  const proposals = await loadProposalStates(a.ctx.supabase, proposalIdsOf(rows as unknown as StoredMessage[]));
  const lastId = rows[rows.length - 1]?.id;
  return rows.map((m) => {
    const result = parseAssistantResult(m.result);
    const phase = m.role === "assistant" ? turnPhase(result, now) : "done";
    return {
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      createdAt: m.created_at,
      error: result.error ?? null,
      plan: result.plan ?? [],
      phase,
      canResume: m.role === "assistant" && m.id === lastId && canResume(phase, result.steps, proposals),
      steps: result.steps.map((s) => {
        const p = s.proposal_id ? proposals.get(s.proposal_id) : undefined;
        return { ...s, proposal: p ? { phase: proposalPhase(p.status), label: p.label } : s.proposal_id ? null : undefined };
      }),
    };
  });
}
