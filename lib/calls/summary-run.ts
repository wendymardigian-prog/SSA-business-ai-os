/**
 * Resumir UNA llamada de punta a punta (F29, F30). Es lo que corre el job
 * `call_summary`; el handler es fino y todo lo que decide vive aca, con la base
 * y el modelo por parametro.
 *
 * Que hace, en orden:
 *   1. Si la llamada no se puede resumir (sin transcripcion, o es equipo, no
 *      show o clase), no llama al modelo.
 *   2. Respeta el tope de gasto del workspace.
 *   3. Pide el resumen. Si la llamada tiene contacto, en la MISMA llamada le da
 *      la memoria previa y recibe la integrada.
 *   4. Guarda el resumen. Las ideas de contenido van como PROPUESTAS de la
 *      grabación (idea o borrador, con su cita): resumir de nuevo reemplaza solo
 *      las pendientes. Una grabación cuyas ideas ya entraron solas al banco
 *      (antes de las propuestas: `ideas_created_at`) no vuelve a proponerlas.
 *   5. Escribe la memoria con control de concurrencia (`memory.ts`).
 *
 * Un fallo del modelo no lanza: se reintenta a los 1, 5 y 15 minutos y, agotado,
 * `summary_status = 'error'` (la persona lo reintenta con "Resumir").
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { auditAsSystem } from "@/lib/audit";
import { openAiRun } from "@/lib/ai/run";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { resolveTaskModel } from "@/lib/ai-tasks/model";
import { loadTaskInstructionsForRun } from "@/lib/ai-tasks/store";
import { aiSdkGenerate, type GenerateFn } from "./ai-generate";
import { decideAiFailure } from "./ai-retry";
import { applyMemory, readContactMemory } from "./memory";
import { enqueueCallJob } from "./queue";
import { derivedCallType } from "./legacy-type";
import { contentProposalsFromSummary, memoryApplies, runCallSummary, summaryEligibility } from "./summary";
import { CONTENT_TYPES } from "./proposals";
import { replacePendingProposals } from "./proposals-write";
import { transcriptText } from "./transcript-text";
import { randomUUID } from "node:crypto";
import { withManualKept } from "./manual-summary";

type Db = SupabaseClient<Database>;

export type SummaryOutcome = "gone" | "not_eligible" | "budget" | "done" | "retry" | "error";

export interface SummaryJobPayload {
  callId: string;
  retry?: number;
  manual?: boolean;
  requestedBy?: string | null;
}

export interface SummaryDeps {
  db: Db;
  now?: Date;
  generate?: GenerateFn;
}

const CALL_COLUMNS = "id, workspace_id, title, category_snapshot, no_show, analysis_profile_id, recorded_at, attendees, transcript, contact_id, ideas_created_at, summary";

export async function runCallSummaryJob(deps: SummaryDeps, payload: SummaryJobPayload): Promise<{ outcome: SummaryOutcome }> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const retry = payload.retry ?? 0;

  const { data: row } = await db.from("calls").select(CALL_COLUMNS).eq("id", payload.callId).is("archived_at", null).maybeSingle();
  if (!row) return { outcome: "gone" };
  const call = { ...row, call_type: await derivedCallType(db, row.workspace_id, row) };

  const eligibility = summaryEligibility(call);
  if (!eligibility.ok) {
    await db.from("calls").update({ summary_status: "none" }).eq("id", call.id);
    return { outcome: "not_eligible" };
  }

  const budget = await withinWorkspaceBudget(db, call.workspace_id, now, { task: "call_summary" });
  if (!budget.allowed) {
    await db.from("calls").update({ summary_status: "error" }).eq("id", call.id);
    return { outcome: "budget" };
  }

  // La memoria del contacto: solo si la llamada tiene contacto y no es de equipo.
  // Lo decide el analizador con el que se analizo; una grabacion vieja, sin analizador, como siempre.
  let profileWantsMemory = true;
  if (call.analysis_profile_id) {
    const { data: profile } = await db.from("call_analysis_profiles").select("auto_memory").eq("id", call.analysis_profile_id).maybeSingle();
    profileWantsMemory = profile?.auto_memory !== false;
  }
  const read = profileWantsMemory && memoryApplies(call) && call.contact_id ? await readContactMemory(db, call.contact_id) : null;
  const withMemory = read !== null;

  const [model, instructions] = await Promise.all([
    resolveTaskModel(db, call.workspace_id, "call_summary"),
    loadTaskInstructionsForRun(db, call.workspace_id, "call_summary"),
  ]);
  if (!deps.generate && (!model.ok || !model.model)) {
    await db.from("calls").update({ summary_status: "error" }).eq("id", call.id);
    return { outcome: "error" };
  }

  const run = await openAiRun(db, {
    workspaceId: call.workspace_id,
    source: "call_summary",
    trigger: payload.manual ? "manual" : "job",
    promptVersion: instructions.version,
    contactId: call.contact_id,
    threadId: call.id,
  });
  if (model.provider && model.modelId) run.setModel(model.provider, model.modelId);
  const generate = deps.generate ?? aiSdkGenerate(model.model!);

  const ask = async (previousMemory: string | null) => {
    const startedAt = Date.now();
    const r = await runCallSummary({ call, previousMemory, withMemory, instructions: instructions.text, generate });
    if (r.ok) {
      run.addStepUsage(r.usage);
      await run.step({ kind: "model_call", name: `${model.provider ?? "ia"}/${model.modelId ?? "modelo"}`, output: { ideas: r.summary.ideas.length, memoria: Boolean(r.summary.memoria) }, durationMs: Date.now() - startedAt });
    }
    return r;
  };

  const first = await ask(read?.memory ?? null);
  if (!first.ok) {
    await run.close({ status: "error", statusDetail: "generation_failed", error: first.error.slice(0, 300) });
    const decision = decideAiFailure(first.cause, retry);
    if (decision.action === "retry") {
      await db.from("calls").update({ summary_status: "pending" }).eq("id", call.id);
      await enqueueCallJob(db, "call_summary", call.id, now, { ...payload, retry: decision.nextRetry }, new Date(now.getTime() + decision.delayMs));
      return { outcome: "retry" };
    }
    await db.from("calls").update({ summary_status: "error" }).eq("id", call.id);
    return { outcome: "error" };
  }

  const { memoria, ...summary } = first.summary;
  const modelLabel = model.provider && model.modelId ? `${model.provider}/${model.modelId}` : "modelo";

  // Las ideas, como propuestas (solo reemplaza las pendientes de contenido). Si ya entraron solas al banco, no.
  if (!call.ideas_created_at) {
    const fresh = contentProposalsFromSummary(summary, transcriptText(call.transcript), () => randomUUID());
    await replacePendingProposals(db as never, { callId: call.id, types: CONTENT_TYPES, fresh });
  }

  // La memoria, con control de concurrencia (un reintento).
  let memoryStatus: "none" | "applied" | "conflict" | "skipped" = "none";
  let memoryAppliedAt: string | null = null;
  if (withMemory && read && call.contact_id) {
    const outcome = await applyMemory(db, {
      contactId: call.contact_id,
      read,
      first: memoria ?? null,
      produce: async (previous) => {
        const second = await ask(previous);
        return second.ok ? second.summary.memoria ?? null : null;
      },
      now,
    });
    memoryStatus = outcome.status;
    if (outcome.status === "applied") {
      memoryAppliedAt = now.toISOString();
      await auditAsSystem({
        supabase: db,
        workspaceId: call.workspace_id,
        entityType: "contact",
        entityId: call.contact_id,
        action: "summary",
        changes: { ai_conversation_summary: { old: outcome.previous, new: outcome.memory } },
        metadata: { origin: "call_summary", call_id: call.id },
        label: "Resumen de llamada",
      });
    }
  }

  // El costo es la suma de los pasos (puede haber dos si hubo que reintegrar la memoria).
  await run.close({ status: "responded", statusDetail: memoryStatus === "conflict" ? "memory_conflict" : null });

  const { error } = await db
    .from("calls")
    .update({
      // Lo que se cargó a mano (Servicios A4, F141) se conserva: vive en `summary.manual`.
      summary: withManualKept({ ...summary, generated_at: now.toISOString(), model: modelLabel, prompt_version: instructions.version }, (call as { summary?: unknown }).summary) as unknown as Json,
      summary_status: "done",
      memory_status: memoryStatus,
      ...(memoryAppliedAt ? { memory_applied_at: memoryAppliedAt } : {}),
    })
    .eq("id", call.id);
  if (error) {
    console.error("[call_summary] no pude guardar el resumen:", error.message);
    return { outcome: "error" };
  }
  return { outcome: "done" };
}
