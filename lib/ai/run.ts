import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AgentRunSource,
  AgentRunStatus,
  AgentRunStepKind,
  AgentRunTrigger,
  Database,
  Json,
} from "@/lib/types/database";
import {
  computeChatCostUsd,
  computeEmbeddingCostUsd,
  resolvePricing,
  safeTokens,
} from "./pricing";

/**
 * La unica puerta de salida hacia los proveedores de IA: el run.
 *
 * Toda llamada a un modelo del sistema (el agente, el nodo AI Response de los
 * flows, los pasos de IA de las secuencias, la indexacion de la base de
 * conocimiento, los resumenes de cierre) abre un run antes de llamar y lo
 * cierra despues. El run mide tokens y latencia, busca el precio vigente y
 * congela el costo. Sin esto, "cuanto gaste en IA este mes" es un numero falso.
 *
 * Tres reglas que ordenan el archivo:
 *
 * 1. El run se abre en `running` ANTES de la llamada. Un proceso que muere a
 *    mitad deja la fila como evidencia; un barrido la cierra en `error`
 *    (closeStaleRuns). Un run que se escribe solo al final no deja rastro de
 *    lo que se murio.
 *
 * 2. Registrar nunca rompe al que llama. Si la base no acepta el insert, el
 *    handle sigue funcionando sin id (todo se vuelve no-op) y el error va al
 *    log. Un flow no puede dejar de contestar porque no se pudo anotar el costo.
 *
 * 3. Dos cubos de tokens, y se usa UNO. Cada paso suma su usage en un
 *    acumulador (addStepUsage); si el turno termina bien, quien llama pasa el
 *    total final del SDK (setFinalUsage), que es mas confiable. Al cerrar se
 *    usa el final si existe y si no el acumulado: asi un timeout a mitad del
 *    turno igual guarda lo que ya se gasto, y un turno completo no cuenta dos
 *    veces. Los embeddings van en su propio cubo, que siempre se suma.
 *
 * Nunca se loguea contenido de mensajes, fragmentos de documentos ni keys.
 * Este modulo escribe con el cliente que recibe: tiene que ser service role
 * (agent_runs no tiene policy de INSERT, 00060).
 */

type Db = SupabaseClient<Database>;

export interface OpenRunInput {
  workspaceId: string;
  source: AgentRunSource;
  trigger: AgentRunTrigger;
  agentId?: string | null;
  promptVersion?: number | null;
  conversationId?: string | null;
  threadId?: string | null;
  contactId?: string | null;
  channelId?: string | null;
  provider?: string | null;
  model?: string | null;
}

/** Lo que importa del LanguageModelUsage del AI SDK, tolerante a campos que faltan. */
export interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  /** Campo viejo del SDK, por si un proveedor todavia lo usa. */
  cachedInputTokens?: number;
}

export interface StepInput {
  kind: AgentRunStepKind;
  name?: string | null;
  input?: unknown;
  output?: unknown;
  kbChunkIds?: string[] | null;
  auditLogId?: string | null;
  durationMs?: number | null;
  error?: string | null;
}

export interface CloseRunInput {
  status: Exclude<AgentRunStatus, "running">;
  statusDetail?: string | null;
  /** Mensaje de error apto para mostrar: sin contenido del lead ni keys. */
  error?: string | null;
}

export interface CloseRunResult {
  costUsd: number | null;
  pricingMissing: string[];
}

export interface AiRunHandle {
  readonly runId: string | null;
  /** Proveedor y modelo realmente usados (puede ser el de respaldo). */
  setModel(provider: string, model: string): void;
  addStepUsage(usage: UsageLike | undefined): void;
  setFinalUsage(usage: UsageLike | undefined): void;
  addEmbeddingUsage(args: { provider: string; model: string; tokens: number }): void;
  step(input: StepInput): Promise<string | null>;
  close(input: CloseRunInput): Promise<CloseRunResult>;
}

interface Bucket {
  input: number;
  cachedRead: number;
  output: number;
}

const emptyBucket = (): Bucket => ({ input: 0, cachedRead: 0, output: 0 });

function toBucket(usage: UsageLike): Bucket {
  return {
    input: safeTokens(usage.inputTokens),
    cachedRead: safeTokens(usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens),
    output: safeTokens(usage.outputTokens),
  };
}

const MAX_STEP_STRING = 2_000;
const MAX_ERROR_CHARS = 500;

/**
 * La salida "resumida" de un paso: strings recortados, profundidad acotada.
 * El detalle del run tiene que leerse, no ser un volcado de megas.
 */
export function summarizeForStep(value: unknown, depth = 0): Json | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    return value.length > MAX_STEP_STRING ? `${value.slice(0, MAX_STEP_STRING)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[…]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => summarizeForStep(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, Json | null> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[k] = summarizeForStep(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function openAiRun(
  supabase: Db,
  input: OpenRunInput,
  clock: () => Date = () => new Date(),
): Promise<AiRunHandle> {
  const openedAt = clock();

  let runId: string | null = null;
  try {
    const { data, error } = await supabase
      .from("agent_runs")
      .insert({
        workspace_id: input.workspaceId,
        source: input.source,
        trigger: input.trigger,
        agent_id: input.agentId ?? null,
        prompt_version: input.promptVersion ?? null,
        conversation_id: input.conversationId ?? null,
        thread_id: input.threadId ?? null,
        contact_id: input.contactId ?? null,
        channel_id: input.channelId ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
        status: "running",
        created_at: openedAt.toISOString(),
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error(`[ai-run] no pude abrir el run (${input.source}):`, error?.message ?? "sin fila");
    } else {
      runId = data.id;
    }
  } catch (err) {
    console.error(`[ai-run] no pude abrir el run (${input.source}):`, err instanceof Error ? err.message : "error desconocido");
  }

  let provider = input.provider ?? null;
  let model = input.model ?? null;
  const stepBucket = emptyBucket();
  let finalBucket: Bucket | null = null;
  const embeddings = new Map<string, { provider: string; model: string; tokens: number }>();
  let stepCount = 0;
  let closed: CloseRunResult | null = null;
  // Los pasos se escriben en serie: step_index es unico por run.
  let stepChain: Promise<unknown> = Promise.resolve();

  const handle: AiRunHandle = {
    get runId() {
      return runId;
    },

    setModel(p, m) {
      provider = p;
      model = m;
    },

    addStepUsage(usage) {
      if (!usage) return;
      const b = toBucket(usage);
      stepBucket.input += b.input;
      stepBucket.cachedRead += b.cachedRead;
      stepBucket.output += b.output;
    },

    setFinalUsage(usage) {
      if (!usage) return;
      finalBucket = toBucket(usage);
    },

    addEmbeddingUsage({ provider: p, model: m, tokens }) {
      const key = `${p}/${m}`;
      const prev = embeddings.get(key);
      embeddings.set(key, { provider: p, model: m, tokens: (prev?.tokens ?? 0) + safeTokens(tokens) });
    },

    step(stepInput) {
      const index = stepCount++;
      const write = stepChain.then(async () => {
        if (!runId) return null;
        const { data: row, error: stepError } = await supabase
          .from("agent_run_steps")
          .insert({
            workspace_id: input.workspaceId,
            run_id: runId,
            step_index: index,
            kind: stepInput.kind,
            name: stepInput.name ?? null,
            input: summarizeForStep(stepInput.input),
            output: summarizeForStep(stepInput.output),
            kb_chunk_ids: stepInput.kbChunkIds ?? null,
            audit_log_id: stepInput.auditLogId ?? null,
            duration_ms: stepInput.durationMs ?? null,
            error: clip(stepInput.error, MAX_ERROR_CHARS),
          })
          .select("id")
          .single();
        if (stepError) {
          console.error("[ai-run] no pude guardar un paso:", stepError.message);
          return null;
        }
        return row?.id ?? null;
      });
      stepChain = write.catch(() => null);
      return write.catch(() => null);
    },

    async close(closeInput) {
      if (closed) return closed;
      await stepChain;

      const chat: Bucket = finalBucket ?? stepBucket;
      const embeddingTokens = [...embeddings.values()].reduce((sum, e) => sum + e.tokens, 0);
      const pricingMissing: string[] = [];
      let costUsd: number | null = 0;
      let pricingId: string | null = null;
      const at = clock();

      const usedChat = chat.input > 0 || chat.output > 0;
      if (usedChat) {
        const price =
          provider && model
            ? await resolvePricing(supabase, { workspaceId: input.workspaceId, provider, model, at })
            : null;
        if (price) {
          costUsd = (costUsd ?? 0) + computeChatCostUsd(price, chat);
          pricingId = price.id;
        } else {
          pricingMissing.push(`${provider ?? "?"}/${model ?? "?"}`);
        }
      }

      for (const e of embeddings.values()) {
        if (e.tokens === 0) continue;
        const price = await resolvePricing(supabase, {
          workspaceId: input.workspaceId,
          provider: e.provider,
          model: e.model,
          at,
        });
        if (price) {
          costUsd = (costUsd ?? 0) + computeEmbeddingCostUsd(price, e.tokens);
        } else {
          pricingMissing.push(`${e.provider}/${e.model}`);
        }
      }

      // Un total parcial mentiria: si falta un precio, el costo es desconocido.
      if (pricingMissing.length > 0) costUsd = null;
      if (costUsd !== null) costUsd = Math.round(costUsd * 1_000_000) / 1_000_000;

      const details = [
        closeInput.statusDetail ?? null,
        pricingMissing.length ? `pricing_missing:${pricingMissing.join(",")}` : null,
      ].filter(Boolean);

      closed = { costUsd, pricingMissing };

      if (!runId) return closed;

      try {
        const { error: closeError } = await supabase
          .from("agent_runs")
          .update({
            status: closeInput.status,
            status_detail: details.length ? details.join(" | ") : null,
            error: clip(closeInput.error, MAX_ERROR_CHARS),
            provider,
            model,
            input_tokens: usedChat ? chat.input : null,
            output_tokens: usedChat ? chat.output : null,
            cached_tokens: usedChat ? chat.cachedRead : null,
            embedding_tokens: embeddingTokens > 0 ? embeddingTokens : null,
            cost_usd: costUsd,
            pricing_id: pricingId,
            latency_ms: Math.max(0, at.getTime() - openedAt.getTime()),
            step_count: stepCount,
            completed_at: at.toISOString(),
          })
          .eq("id", runId);

        if (closeError) console.error("[ai-run] no pude cerrar el run:", closeError.message);
      } catch (err) {
        console.error("[ai-run] no pude cerrar el run:", err instanceof Error ? err.message : "error desconocido");
      }
      return closed;
    },
  };

  return handle;
}

/**
 * Registra un run que termino sin llamar a ningun proveedor: el agente se
 * abstuvo, un guardarrail lo bloqueo, el canal estaba apagado. Toda abstencion
 * deja rastro; un "no contesto" sin explicacion es imposible de depurar.
 */
export async function recordRunOutcome(
  supabase: Db,
  input: OpenRunInput & CloseRunInput,
): Promise<string | null> {
  const run = await openAiRun(supabase, input);
  await run.close({ status: input.status, statusDetail: input.statusDetail, error: input.error });
  return run.runId;
}

/**
 * Cierra en `error` los runs que quedaron abiertos: el proceso murio a mitad
 * del turno. Lo corre el cron del agente.
 */
export interface StaleRun {
  id: string;
  source: AgentRunSource;
  workspace_id: string;
  conversation_id: string | null;
}

export async function closeStaleRuns(
  supabase: Db,
  { olderThanMinutes = 10, now = new Date() }: { olderThanMinutes?: number; now?: Date } = {},
): Promise<StaleRun[]> {
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("agent_runs")
    .update({
      status: "error",
      status_detail: "stale_running",
      error: "El run quedo abierto: el proceso se corto antes de terminar.",
      completed_at: now.toISOString(),
    })
    .eq("status", "running")
    .lt("created_at", cutoff)
    .select("id, source, workspace_id, conversation_id");

  if (error) {
    console.error("[ai-run] no pude cerrar runs colgados:", error.message);
    return [];
  }
  return (data ?? []) as StaleRun[];
}
