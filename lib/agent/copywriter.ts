/**
 * El agente copywriter (grupo E).
 *
 * Reemplaza la generacion simple de F29. La diferencia no es el modelo: es
 * que ahora hay **un agente**, con su configuracion, su voz, sus limites,
 * sus topes de gasto y su historial de ejecuciones. Antes el copy salia de
 * una llamada anonima que no quedaba registrada en ningun lado.
 *
 * Como trabaja: primero junta el contexto de forma determinista —la idea, lo
 * que mejor funciono en esa red y formato, las palabras clave que disparan
 * algo de verdad, lo que sabe del negocio— y cada lectura queda como un paso
 * del run. Despues hace UNA llamada con salida estructurada.
 *
 * Lo que NO hace, a proposito: no publica, no cambia estados y no toca nada
 * fuera del borrador. Escribe y deja una version firmada.
 *
 * La firma (`{ agentId, postId, instructions?, threadId? }`) es la que va a
 * necesitar la Etapa 3 para registrarlo como herramienta del agente general.
 */

import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { openAiRun } from "@/lib/ai/run";
import { checkSpendLimits } from "@/lib/ai/spend";
import { loadAutomationRules } from "@/lib/publishing/post-ids";
import {
  copyOutputSchema,
  SYSTEM_PROMPT,
  buildPrompt,
  validateCopyOutput,
  type CopyOutput,
  type CopyRequest,
} from "@/lib/content/ai-copy";
import {
  buildCopywriterPrompt,
  checkGuardrails,
  offerableKeywords,
  pickTopPosts,
  readCopywriterConfig,
  type CopywriterConfig,
  type PastPost,
} from "@/lib/content/copywriter";

type Db = SupabaseClient<Database>;

export interface CopywriterInput {
  agentId: string;
  postId: string;
  /** "mas corto, mas directo". Queda guardado en el run. */
  instructions?: string | null;
  /** Para la Etapa 3, cuando esto sea una herramienta de una conversacion. */
  threadId?: string | null;
}

export type CopywriterResult =
  | {
      ok: true;
      output: CopyOutput;
      warnings: string[];
      runId: string | null;
      costUsd: number | null;
    }
  | {
      ok: false;
      error: string;
      reason: "no_agent" | "no_post" | "no_provider" | "spend_limit" | "invalid_output" | "failed";
    };

/** Inyectables para probar sin llamar a nadie. */
export interface CopywriterDeps {
  generate?: typeof generateObject;
}

export async function runCopywriter(
  supabase: Db,
  input: CopywriterInput,
  deps: CopywriterDeps = {},
): Promise<CopywriterResult> {
  const generate = deps.generate ?? generateObject;

  // ── El agente y su configuracion ────────────────────────────────────────
  const { data: agent } = await supabase
    .from("agents")
    .select(
      "id, workspace_id, name, type, is_enabled, system_prompt, active_prompt_version, provider, model, fallback_provider, fallback_model, temperature, max_output_tokens, config, knowledge_tags, daily_cost_limit_usd, daily_cost_limit_action, monthly_cost_limit_usd, monthly_cost_limit_action",
    )
    .eq("id", input.agentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!agent || agent.type !== "copywriter") {
    return { ok: false, reason: "no_agent", error: "No encontre el copywriter de este negocio." };
  }

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, workspace_id, title, format, script, caption, networks, idea_id")
    .eq("id", input.postId)
    .eq("workspace_id", agent.workspace_id)
    .maybeSingle();

  if (!post) return { ok: false, reason: "no_post", error: "No encontre esa pieza." };

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("content_copy_settings, ai_daily_cost_limit_usd, ai_monthly_cost_limit_usd, timezone")
    .eq("id", agent.workspace_id)
    .maybeSingle();

  const config = readCopywriterConfig(agent, workspace?.content_copy_settings);

  // ── Los topes, ANTES de gastar ──────────────────────────────────────────
  //
  // Los del agente Y los del workspace. El camino viejo solo miraba los del
  // workspace, asi que un tope propio del copywriter no significaba nada.
  const spend = await checkSpendLimits(supabase, {
    workspaceId: agent.workspace_id,
    agentId: agent.id,
    limits: {
      agentDailyUsd: agent.daily_cost_limit_usd,
      agentDailyAction: agent.daily_cost_limit_action,
      agentMonthlyUsd: agent.monthly_cost_limit_usd,
      agentMonthlyAction: agent.monthly_cost_limit_action,
      workspaceDailyUsd: workspace?.ai_daily_cost_limit_usd ?? null,
      workspaceMonthlyUsd: workspace?.ai_monthly_cost_limit_usd ?? null,
    },
    timeZone: workspace?.timezone ?? undefined,
  });

  if (!spend.allowed) {
    const detalle =
      "blocking" in spend && spend.blocking
        ? `Se alcanzo el tope de gasto de IA (${spend.blocking.scope}).`
        : "No pude leer cuanto se gasto, asi que no gasto mas por las dudas.";
    return { ok: false, reason: "spend_limit", error: detalle };
  }

  const resolved = await getWorkspaceModel(agent.workspace_id, {
    preferredProvider: agent.provider ?? undefined,
    modelId: agent.model ?? undefined,
    supabase,
  });

  if (!resolved.ok || !resolved.model) {
    return {
      ok: false,
      reason: "no_provider",
      error: "No hay ningun proveedor de IA configurado. Conecta uno en Ajustes -> Integraciones.",
    };
  }

  const run = await openAiRun(supabase, {
    workspaceId: agent.workspace_id,
    source: "content_copy",
    trigger: "job",
    agentId: agent.id,
    promptVersion: agent.active_prompt_version,
    threadId: input.threadId ?? null,
    provider: resolved.provider,
    model: resolved.modelId,
  });

  try {
    const context = await gatherContext(supabase, {
      agentWorkspaceId: agent.workspace_id,
      post,
      config,
      instructions: input.instructions ?? null,
      run,
    });

    const prompt = [buildPrompt(context.request), buildCopywriterPrompt(context)]
      .filter(Boolean)
      .join("\n\n");

    const result = await generate({
      model: resolved.model,
      schema: copyOutputSchema,
      system: SYSTEM_PROMPT,
      prompt,
      ...(agent.temperature !== null ? { temperature: agent.temperature } : {}),
      ...(agent.max_output_tokens !== null ? { maxOutputTokens: agent.max_output_tokens } : {}),
    } as never);

    run.setFinalUsage((result as unknown as { usage?: Record<string, number> }).usage ?? {});
    await run.step({
      kind: "model_call",
      name: "escribir",
      input: { prompt_chars: prompt.length },
      output: { ok: true },
    });

    const platforms = context.request.platforms;
    const validated = validateCopyOutput((result as { object?: unknown }).object, platforms);

    if (!validated.ok) {
      await run.close({ status: "error", error: validated.error });
      return { ok: false, reason: "invalid_output", error: validated.error };
    }

    // Los limites son advertencias y no rechazo: el copy queda en el
    // borrador con el aviso al lado, y se arregla en dos segundos. Tirarlo
    // costaria otra llamada por una frase.
    const avisos = checkGuardrails(validated.output, config.guardrails);
    if (avisos.length > 0) {
      await run.step({ kind: "guardrail", name: "limites", output: { avisos } });
    }

    const closed = await run.close({ status: "completed" });

    return {
      ok: true,
      output: validated.output,
      warnings: [...validated.warnings, ...avisos],
      runId: run.runId,
      costUsd: closed.costUsd,
    };
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error("[copywriter] la generacion fallo:", detalle);
    await run.close({ status: "error", error: detalle });
    return { ok: false, reason: "failed", error: "No pude escribir el copy. Proba de nuevo." };
  }
}

// ── El contexto, paso por paso ────────────────────────────────────────────

interface PostRow {
  id: string;
  workspace_id: string;
  title: string;
  format: string | null;
  script: string | null;
  caption: string | null;
  networks: unknown;
  idea_id: string | null;
}

/**
 * Junta el contexto de forma determinista.
 *
 * Cada lectura queda como un paso del run: si el copy sale raro, se puede
 * mirar exactamente que vio el agente, sin adivinar.
 */
async function gatherContext(
  supabase: Db,
  params: {
    agentWorkspaceId: string;
    post: PostRow;
    config: CopywriterConfig;
    instructions: string | null;
    run: Awaited<ReturnType<typeof openAiRun>>;
  },
) {
  const { post, config, run } = params;

  const networks = (Array.isArray(post.networks) ? post.networks : []) as Array<{
    platform?: string;
  }>;
  const platforms = networks.map((n) => String(n.platform ?? "")).filter(Boolean);
  const principal = platforms[0] ?? "instagram";

  // 1. La idea de la que salio.
  const idea = post.idea_id
    ? (
        await supabase
          .from("content_ideas")
          .select("title, content, reference")
          .eq("id", post.idea_id)
          .maybeSingle()
      ).data
    : null;

  await run.step({
    kind: "tool_call",
    name: "leer_idea",
    output: { encontrada: Boolean(idea) },
  });

  // 2. Lo que mejor funciono en esa red y ese formato.
  const { data: pasados } = await supabase
    .from("social_posts")
    .select("platform, caption, engagement_d7, published_at, content_posts(format)")
    .eq("workspace_id", post.workspace_id)
    .eq("status", "published")
    .not("engagement_d7", "is", null)
    .order("engagement_d7", { ascending: false })
    .limit(50);

  const candidatos: PastPost[] = (pasados ?? []).map((row) => ({
    platform: row.platform,
    format: (row.content_posts as { format?: string | null } | null)?.format ?? null,
    caption: row.caption,
    engagement: row.engagement_d7 === null ? null : Number(row.engagement_d7),
    publishedAt: row.published_at,
  }));

  const top = pickTopPosts(candidatos, { platform: principal, format: post.format });
  await run.step({
    kind: "tool_call",
    name: "mejores_posts",
    input: { red: principal, formato: post.format },
    output: { elegidos: top.length, de: candidatos.length },
  });

  // 3. Las palabras clave que disparan algo de verdad.
  const rules = await loadAutomationRules(supabase, post.workspace_id);
  const { data: account } = await supabase
    .from("social_accounts")
    .select("channel_id")
    .eq("workspace_id", post.workspace_id)
    .eq("platform", principal as never)
    .maybeSingle();

  const keywords = offerableKeywords(rules, principal, account?.channel_id ?? null);
  await run.step({
    kind: "tool_call",
    name: "palabras_clave",
    output: { disponibles: keywords.map((k) => k.keyword) },
  });

  // 4. Lo que sabe del negocio, de las etiquetas que tiene configuradas.
  const knowledge = config.knowledgeTags.length
    ? (
        await supabase
          .from("knowledge_base")
          .select("title, content_md")
          .eq("workspace_id", post.workspace_id)
          .overlaps("tags", config.knowledgeTags)
          // Lo marcado como interno nunca llega al prompt de un agente.
          .eq("internal_only", false)
          .eq("status", "ready")
          .limit(5)
      ).data ?? []
    : [];

  await run.step({
    kind: "kb_search",
    name: "conocimiento",
    input: { etiquetas: config.knowledgeTags },
    output: { fragmentos: knowledge.length },
  });

  const request: CopyRequest = {
    idea,
    title: post.title,
    format: post.format,
    platforms: platforms.length > 0 ? platforms : [principal],
    brand: config.brand,
    existingScript: post.script?.trim() ? post.script : null,
  };

  return {
    request,
    config,
    topPosts: top.map((p) => ({
      platform: p.platform,
      caption: p.caption ?? "",
      engagement: p.engagement,
    })),
    keywords,
    knowledge: (knowledge as Array<{ title: string | null; content_md: string | null }>).map((k) => ({
      title: k.title ?? "",
      // Un recorte: el prompt no puede llevarse el documento entero.
      text: (k.content_md ?? "").slice(0, 600),
    })),
    instructions: params.instructions,
  };
}
