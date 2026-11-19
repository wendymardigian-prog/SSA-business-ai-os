"use server";

import { revalidatePath } from "next/cache";
import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { approveProposalCore, rejectProposalCore, type DecideResult } from "@/lib/ai-proposals/core";
import { getPersonTool } from "@/lib/ai-tools/registry";
import { maybeProposeLearnedRule } from "@/lib/ai-learning/rules-run";

/**
 * Bandeja de aprobación. Aprobar (tal cual o editada) o rechazar con motivo una propuesta de un
 * agente. Quién puede: quien VE la propuesta (la RLS con su sesión) y tiene el permiso de la acción; una propuesta del
 * asistente, solo quien la pidió. El workspace sale de la sesión, nunca del navegador.
 */

const APPROVALS_PATH = "/dashboard/agents/aprobaciones";

async function actor() {
  const ctx = await getMemberAction();
  if (!ctx) return null;
  const service = await createServiceClient();
  return {
    ctx,
    decide: {
      session: ctx.supabase,
      service,
      userId: ctx.user.id,
      userName: (ctx.user.user_metadata?.full_name as string | undefined) ?? undefined,
      timeZone: ctx.workspace.timezone ?? "UTC",
      can: ctx.can,
    },
  };
}

const personToolPermission = (key: string) => getPersonTool(key)?.permission ?? null;

export async function approveProposal(proposalId: string, editedParams?: Record<string, unknown> | null): Promise<DecideResult> {
  const a = await actor();
  if (!a) return { ok: false, code: "forbidden", error: "Tu sesión venció. Volvé a entrar." };
  const result = await approveProposalCore(a.decide, {
    workspaceId: a.ctx.workspace.id,
    proposalId,
    editedParams: editedParams ?? undefined,
    personToolPermission,
  });
  revalidatePath(APPROVALS_PATH);
  return result;
}

export async function rejectProposal(proposalId: string, input: { reason: string; note?: string | null }): Promise<DecideResult> {
  const a = await actor();
  if (!a) return { ok: false, code: "forbidden", error: "Tu sesión venció. Volvé a entrar." };
  const result = await rejectProposalCore(a.decide, { workspaceId: a.ctx.workspace.id, proposalId, reason: input?.reason, note: input?.note ?? null });
  // Un rechazo puede proponer una regla aprendida. Nunca tumba el rechazo.
  if (result.ok && result.agentId && result.reason) {
    await maybeProposeLearnedRule(a.decide.service, { workspaceId: a.ctx.workspace.id, agentId: result.agentId, reason: result.reason });
  }
  revalidatePath(APPROVALS_PATH);
  return result.ok ? { ok: true, status: result.status, message: result.message } : result;
}
