/**
 * El job `call_index_knowledge` (F31): manda UNA llamada a la base de
 * conocimiento. Fino a proposito: la logica vive en `lib/calls/knowledge-run.ts`.
 *
 * Igual que `index_document`, solo lanza cuando el fallo es transitorio (Voyage
 * con 429, la red) para que el runner reintente; un fallo permanente (Voyage sin
 * conectar) deja el documento en `error` con el motivo y el job termina bien.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { runCallKnowledgeJob } from "@/lib/calls/knowledge-run";

export const CALL_INDEX_KNOWLEDGE_JOB = "call_index_knowledge";

export async function handleCallIndexKnowledge(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as { callId?: string; requestedBy?: string | null };
  if (!payload.callId) {
    console.error("[call_index_knowledge] el job no trae la llamada");
    return;
  }
  const result = await runCallKnowledgeJob({ db: ctx.supabase as SupabaseClient<Database> }, { callId: payload.callId, requestedBy: payload.requestedBy });
  console.log(`[call_index_knowledge] ${result.outcome}`);
  if (result.outcome === "error" && result.retryable) throw new Error(result.detail);
}

export function registerCallIndexKnowledgeHandler(): void {
  registerJobHandler(CALL_INDEX_KNOWLEDGE_JOB, handleCallIndexKnowledge);
}
