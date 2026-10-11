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
 *   4. Guarda el resumen; crea las ideas de contenido SOLO la primera vez
 *      (resumir de nuevo no las duplica).
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
import { loadTaskInstructions } from "@/lib/ai-tasks/store";
import { aiSdkGenerate, type GenerateFn } from "./ai-generate";
import { decideAiFailure } from "./ai-retry";
import { applyMemory, readContactMemory } from "./memory";
import { enqueueCallJob } from "./queue";
import { ideasFromSummary, memoryApplies, runCallSummary, summaryEligibility } from "./summary";

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

const CALL_COLUMNS = "id, workspace_id, title, call_type, recorded_at, attendees, transcript, contact_id, ideas_created_at";

export async function runCallSummaryJob(deps: SummaryDeps, payload: SummaryJobPayload): Promise<{ outcome: SummaryOutcome }> {
  const { db } = deps;
  const now = deps.now ?? new Date();
  const retry = payload.retry ?? 0;

  const { data: call } = await db.from("calls").select(CALL_COLUMNS).eq("id", payload.callId).is("archived_at", null).maybeSingle();
  if (!call) return { outcome: "gone" };

  const eligibility = summaryEligibility(call);
  if (!eligibility.ok) {
    await db.from("calls").update({ summary_status: "none" }).eq("id", call.id);
    return { outcome: "not_eligible" };
  }

  const budget = await withinWorkspaceBudget(db, call.workspace_id, now);
  if (!budget.allowed) {
    await db.from("calls").update({ summary_status: "error" }).eq("id", call.id);
    return { outcome: "budget" };
  }

  // La memoria del contacto: solo si la llamada tiene contacto y no es de equipo.
  const read = memoryApplies(call) && call.contact_id ? await readContactMemory(db, call.contact_id) : null;
  const withMemory = read !== null;

  const [model, instructions] = await Promise.all([
    resolveTaskModel(db, call.workspace_id, "call_summary"),
    loadTaskInstructions(db, call.workspace_id, "call_summary"),
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
  const { data: ws } = await db.from("workspaces").select("timezone").eq("id", call.workspace_id).maybeSingle();

  // Las ideas, solo la primera vez que el resumen sale bien.
  let ideasCreatedAt: string | null = call.ideas_created_at;
  if (!call.ideas_created_at && summary.ideas.length > 0) {
    ideasCreatedAt = (await createIdeas(db, call, first.summary, ws?.timezone ?? "UTC", now)) ? now.toISOString() : null;
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
      summary: { ...summary, generated_at: now.toISOString(), model: modelLabel, prompt_version: instructions.version } as unknown as Json,
      summary_status: "done",
      memory_status: memoryStatus,
      ...(memoryAppliedAt ? { memory_applied_at: memoryAppliedAt } : {}),
      ...(ideasCreatedAt && !call.ideas_created_at ? { ideas_created_at: ideasCreatedAt } : {}),
    })
    .eq("id", call.id);
  if (error) {
    console.error("[call_summary] no pude guardar el resumen:", error.message);
    return { outcome: "error" };
  }
  return { outcome: "done" };
}

async function createIdeas(db: Db, call: { id: string; workspace_id: string; recorded_at: string; contact_id: string | null }, summary: Parameters<typeof ideasFromSummary>[0], timeZone: string, now: Date): Promise<boolean> {
  try {
    let contactName: string | null = null;
    if (call.contact_id) {
      const { data: contact } = await db.from("contacts").select("display_name, email").eq("id", call.contact_id).maybeSingle();
      contactName = contact?.display_name || contact?.email || null;
    }
    const ideas = ideasFromSummary(summary, { recordedAt: call.recorded_at, contactName, timeZone });
    if (ideas.length === 0) return true;
    // Al final de la columna "nueva", leyendo el maximo (contar da mal apenas alguien reordena).
    const { data: last } = await db.from("content_ideas").select("position").eq("workspace_id", call.workspace_id).eq("status", "nueva").order("position", { ascending: false }).limit(1).maybeSingle();
    const base = last?.position ?? 0;
    const { error } = await db.from("content_ideas").insert(
      ideas.map((idea, i) => ({
        ...idea,
        workspace_id: call.workspace_id,
        source: "call" as const,
        call_id: call.id,
        status: "nueva" as const,
        created_by: null,
        position: base + (i + 1) * 10,
        created_at: now.toISOString(),
      })),
    );
    if (error) {
      console.error("[call_summary] no pude crear las ideas:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[call_summary] fallo al crear las ideas:", err instanceof Error ? err.message : "error");
    return false;
  }
}
