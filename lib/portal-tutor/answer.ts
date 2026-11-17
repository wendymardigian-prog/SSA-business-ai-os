// @plantilla-quitar(servicios)
/**
 * Responder una pregunta del portal (F230). Lo llama la ruta firmada `/api/portal/tutor`, con el cliente de servicio.
 *
 * La base decide todo lo que es permiso (`portal_tutor_begin`: sesión, sección, tutor prendido, créditos, topes) y qué
 * material puede ver ese estudiante (`portal_tutor_search`). Acá solo se corre el modelo del tutor y se guarda la
 * respuesta. La corrida queda en `agent_runs` con `source = 'portal_tutor'`, el tutor y el contacto: su costo es lo que
 * descuenta los créditos del mes (00352). Si algo falla, se guarda un aviso en la conversación (sin costo) para que el
 * estudiante pueda volver a preguntar enseguida.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import type { Database } from "@/lib/types/database";
import { svcRpc, type SvcError } from "@/lib/services/db";
import { openAiRun } from "@/lib/ai/run";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import { loadLanguageStyle } from "@/lib/ai/language-style-load";
import { embedQuery } from "@/lib/knowledge/embeddings";
import { toPgVector } from "@/lib/knowledge/voyage";
import { newNonce, wrapUntrusted } from "@/lib/agent/untrusted";
import { clampGeneration } from "@/lib/ai/generate-reply";
import {
  TUTOR_HISTORY,
  TUTOR_MAX_FRAGMENTS,
  TUTOR_MIN_SIMILARITY,
  defaultTutorPrompt,
  extractCitations,
  fragmentsBlock,
  tutorRules,
  type TutorFragment,
} from "./prompt";

type Db = SupabaseClient<Database>;

export const TUTOR_FAILED = "No pude responder esta vez. Probá de nuevo en un momento.";

export interface TutorBegin {
  workspace_id: string;
  contact_id: string;
  agent_id: string;
  product_id: string;
  program_name: string;
  thread_id: string;
  message_id: string;
}

export type TutorAskResult =
  | { ok: true; thread_id: string; message_id: string }
  | { ok: false; code: string | null; message: string; thread_id?: string };

interface SearchRow {
  chunk_id: string;
  document_title: string;
  content: string;
  item_id: string | null;
  item_title: string | null;
  start_second: number | null;
}

export async function askPortalTutor(db: Db, input: { session: string; productId: string; threadId: string | null; question: string }): Promise<TutorAskResult> {
  const begun = await svcRpc<TutorBegin>(db, "portal_tutor_begin", {
    p_session: input.session,
    p_product_id: input.productId,
    p_thread_id: input.threadId,
    p_question: input.question,
  });
  if (!begun.ok) return refusal(begun.error);
  const b = begun.data;

  const finish = async (answer: string, citations: unknown[], runId: string | null) => {
    const saved = await svcRpc<string>(db, "portal_tutor_finish", { p_thread_id: b.thread_id, p_run_id: runId, p_answer: answer, p_citations: citations });
    return saved.ok ? saved.data : null;
  };
  const fail = async (runId: string | null): Promise<TutorAskResult> => {
    await finish(TUTOR_FAILED, [], runId);
    return { ok: false, code: null, message: TUTOR_FAILED, thread_id: b.thread_id };
  };

  const { data: agent } = await db
    .from("agents")
    .select("system_prompt, provider, model, temperature, max_output_tokens")
    .eq("id", b.agent_id)
    .maybeSingle();
  if (!agent) return fail(null);

  const run = await openAiRun(db, {
    workspaceId: b.workspace_id,
    source: "portal_tutor",
    trigger: "manual",
    agentId: b.agent_id,
    contactId: b.contact_id,
    threadId: b.thread_id,
    provider: agent.provider ?? null,
    model: agent.model ?? null,
  });

  try {
    const budget = await withinWorkspaceBudget(db, b.workspace_id);
    if (!budget.allowed) {
      await run.close({ status: "error", statusDetail: "budget_exceeded", error: budget.message ?? "budget" });
      return fail(run.runId);
    }

    // El material: solo lo que ese estudiante tiene abierto (lo filtra la base).
    let fragments: TutorFragment[] = [];
    const startedAt = Date.now();
    const embedded = await embedQuery(b.workspace_id, input.question.slice(0, 2000), { supabase: db });
    if (embedded.ok) {
      run.addEmbeddingUsage({ provider: "voyage", model: embedded.model, tokens: embedded.totalTokens });
      const found = await svcRpc<SearchRow[]>(db, "portal_tutor_search", {
        p_contact_id: b.contact_id,
        p_product_id: b.product_id,
        p_embedding: toPgVector(embedded.embedding),
        p_match_count: TUTOR_MAX_FRAGMENTS,
        p_min_similarity: TUTOR_MIN_SIMILARITY,
      });
      if (found.ok) {
        fragments = (found.data ?? []).map((r) => ({
          title: r.document_title,
          content: r.content,
          itemId: r.item_id,
          itemTitle: r.item_title,
          startSecond: typeof r.start_second === "number" ? r.start_second : null,
        }));
        await run.step({
          kind: "kb_search",
          name: "buscar_en_el_programa",
          input: { consulta: input.question.slice(0, 300) },
          output: (found.data ?? []).map((r) => ({ documento: r.document_title, clase: r.item_title, segundo: r.start_second })),
          kbChunkIds: (found.data ?? []).map((r) => r.chunk_id),
          durationMs: Date.now() - startedAt,
        });
      }
    }
    if (!embedded.ok) {
      await run.step({ kind: "kb_search", name: "buscar_en_el_programa", input: { consulta: input.question.slice(0, 300) }, error: embedded.problem, durationMs: Date.now() - startedAt });
      await run.close({ status: "error", statusDetail: "kb_unavailable", error: embedded.problem });
      return fail(run.runId);
    }

    const resolved = await getWorkspaceModel(b.workspace_id, { preferredProvider: agent.provider ?? undefined, modelId: agent.model ?? undefined, supabase: db });
    if (!resolved.ok || !resolved.model) {
      await run.close({ status: "error", statusDetail: resolved.problem ?? "no_provider", error: resolved.message ?? "no_provider" });
      return fail(run.runId);
    }
    run.setModel(resolved.provider ?? "", resolved.modelId ?? "");
    if (resolved.provider && resolved.modelId) {
      const priced = await withinWorkspaceBudget(db, b.workspace_id, new Date(), { model: { provider: resolved.provider, model: resolved.modelId } });
      if (!priced.allowed) {
        await run.close({ status: "error", statusDetail: "budget_exceeded", error: priced.message ?? "budget" });
        return fail(run.runId);
      }
    }

    // La conversación hasta acá (sin la pregunta nueva), del más viejo al más nuevo.
    const { data: rows } = await db
      .from("ai_messages")
      .select("id, role, content")
      .eq("thread_id", b.thread_id)
      .neq("id", b.message_id)
      .order("created_at", { ascending: false })
      .limit(TUTOR_HISTORY);
    const nonce = newNonce();
    const history = [...(rows ?? [])].reverse().map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.role === "user" ? wrapUntrusted("lead", nonce, m.content) : m.content,
    }));

    const base = agent.system_prompt?.trim() || defaultTutorPrompt(b.program_name, await loadLanguageStyle(db, b.workspace_id));
    const system = `${base}\n\n${tutorRules(nonce)}\n\n${fragmentsBlock(fragments, nonce)}`;
    const limits = clampGeneration(agent.temperature ?? 0.4, agent.max_output_tokens ?? 900);
    const result = await generateText({
      model: resolved.model,
      system,
      messages: [...history, { role: "user", content: wrapUntrusted("lead", nonce, input.question) }],
      temperature: limits.temperature,
      maxOutputTokens: Math.max(limits.maxOutputTokens, 600),
    });
    run.setFinalUsage(result.totalUsage);
    const { text, citations } = extractCitations(result.text, fragments);
    if (!text) {
      await run.close({ status: "error", statusDetail: "empty_answer", error: "empty" });
      return fail(run.runId);
    }
    await run.close({ status: "responded" });
    const id = await finish(text, citations, run.runId);
    if (!id) return { ok: false, code: null, message: TUTOR_FAILED, thread_id: b.thread_id };
    return { ok: true, thread_id: b.thread_id, message_id: id };
  } catch (err) {
    console.error("[portal-tutor] falló la respuesta:", err instanceof Error ? err.message : "error desconocido");
    await run.close({ status: "error", statusDetail: "generation_failed", error: "generation_failed" }).catch(() => undefined);
    return fail(run.runId);
  }
}

/** Un rechazo de la base con su código PO y su texto (es para mostrar); cualquier otro error, genérico. */
function refusal(e: SvcError): TutorAskResult {
  if (e.code && /^PO\d{3}$/.test(e.code)) return { ok: false, code: e.code, message: e.message };
  console.error("[portal-tutor] portal_tutor_begin falló:", e.code);
  return { ok: false, code: null, message: TUTOR_FAILED };
}
