import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { generateText } from "ai";
import { getWorkspaceModel, type AiProviderProblem } from "./provider";
import { openAiRun, type AiRunHandle, type OpenRunInput } from "./run";

/**
 * Generar una respuesta con IA, sin saber nada de flows.
 *
 * Esto vivia adentro del nodo AI Response, mezclado con dos cosas que no le
 * corresponden: el envio del mensaje y la politica de fallo (cancelar la sesion
 * del flow). Los pasos de IA de las secuencias (F10) necesitan lo primero y no
 * pueden usar lo segundo: no hay flow_sessions ni sessionId cuando el que corre
 * es el cron.
 *
 * Asi que la generacion quedo aca, sin ninguna importacion de flow-engine:
 *   - resuelve el modelo con el BYOK de Vault (la key nunca sale de provider.ts)
 *   - arma el historial de la conversacion
 *   - genera el texto y deja la traza en analytics_events
 *
 * Y lo que NO hace, a proposito: no lanza, no envia, no escribe en `messages`,
 * no toca flow_sessions. Que hacer cuando falla lo decide quien llama, porque
 * un flow y una secuencia tienen que reaccionar distinto.
 *
 * Fase 3: cada generacion deja un run en agent_runs (lib/ai/run.ts) con sus
 * tokens y su costo congelado, con source flow_ai_node o sequence_ai_step.
 * Es cableado, no comportamiento: el resultado que ve quien llama es el mismo,
 * mas un runId opcional. La traza en analytics_events se queda como estaba.
 */

export type AiReplyProblem = AiProviderProblem | "generation_failed";

export interface AiReplyTrace {
  /** De donde nace la generacion. Queda en la metadata para poder separarlas. */
  source: "flow" | "sequence";
  flowId?: string | null;
  sequenceId?: string | null;
  enrollmentId?: string | null;
}

export interface AiReplyRequest {
  workspaceId: string;
  conversationId: string;
  contactId?: string | null;
  provider?: string;
  modelId?: string;
  systemPrompt?: string;
  /**
   * Instruccion puntual para esta generacion.
   *
   * El nodo del flow no la usa (responde al historial). Un paso de secuencia si:
   * ahi no hay un mensaje entrante al que contestar, hay una consigna
   * ("escribile recordandole que la promo vence manana").
   */
  userPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  contextMessages?: number;
  trace: AiReplyTrace;
  /**
   * Run ya abierto por quien llama. Si no viene, se abre uno con el source que
   * corresponde al trace.
   */
  run?: AiRunHandle;
}

export type AiReplyResult =
  | { ok: true; text: string; provider: string; modelId: string; runId?: string | null }
  | { ok: false; problem: AiReplyProblem; message: string; runId?: string | null };

/** El run que le corresponde a cada procedencia. */
export function runInputForTrace(request: AiReplyRequest): OpenRunInput {
  const fromSequence = request.trace.source === "sequence";
  return {
    workspaceId: request.workspaceId,
    source: fromSequence ? "sequence_ai_step" : "flow_ai_node",
    trigger: fromSequence ? "sequence_step" : "flow_node",
    conversationId: request.conversationId,
    contactId: request.contactId ?? null,
    // Lo que agrupa estas llamadas cuando no hay agente: el flow o la inscripcion.
    threadId: fromSequence
      ? request.trace.enrollmentId ?? request.trace.sequenceId ?? null
      : request.trace.flowId ?? null,
    provider: request.provider ?? null,
    model: request.modelId ?? null,
  };
}

const DEFAULT_SYSTEM_PROMPT =
  "Sos un asistente de atencion al cliente. Responde en español rioplatense, breve y claro.";

/**
 * Arma el historial para el modelo, del mas viejo al mas nuevo.
 *
 * Pura y exportada para poder testear el orden sin una base: las filas llegan
 * al reves (la consulta ordena por fecha descendente para quedarse con las
 * ultimas N) y mandarlas asi le da al modelo la conversacion al reves.
 */
export function buildAiMessages(
  rows: Array<{ direction: string; text: string | null }>
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const row of [...rows].reverse()) {
    if (!row.text) continue;
    messages.push({
      role: row.direction === "inbound" ? "user" : "assistant",
      content: row.text,
    });
  }
  return messages;
}

export async function generateAiReply(
  supabase: SupabaseClient<Database>,
  request: AiReplyRequest
): Promise<AiReplyResult> {
  const ownsRun = !request.run;
  const run = request.run ?? (await openAiRun(supabase, runInputForTrace(request)));

  // La key sale de Vault via integration_configs. Nunca llega hasta aca: lo
  // que vuelve es un modelo ya instanciado.
  const resolved = await getWorkspaceModel(request.workspaceId, {
    preferredProvider: request.provider,
    modelId: request.modelId,
    supabase,
  });

  if (!resolved.ok || !resolved.model) {
    const problem = resolved.problem ?? "no_provider";
    const message = resolved.message ?? "No hay un proveedor de IA disponible.";
    await recordTrace(supabase, request, "ai_response_failed", {
      reason: problem,
      message,
    });
    if (ownsRun) await run.close({ status: "error", statusDetail: problem, error: message });
    return { ok: false, problem, message, runId: run.runId };
  }

  run.setModel(resolved.provider ?? "", resolved.modelId ?? "");

  const { data: recentMessages } = await supabase
    .from("messages")
    .select("direction, text")
    .eq("conversation_id", request.conversationId)
    .order("created_at", { ascending: false })
    .limit(request.contextMessages ?? 10);

  const aiMessages = buildAiMessages(recentMessages ?? []);
  if (request.userPrompt) {
    aiMessages.push({ role: "user", content: request.userPrompt });
  }

  // Un modelo no acepta una conversacion vacia. Pasa en una secuencia que
  // arranca con un paso de IA sobre un hilo todavia sin mensajes guardados.
  if (aiMessages.length === 0) {
    aiMessages.push({
      role: "user",
      content: request.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    });
  }

  let text: string;
  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: resolved.model,
      system: request.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      messages: aiMessages,
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: request.maxTokens ?? 500,
    });
    text = result.text;
    run.setFinalUsage(result.totalUsage);
    await run.step({
      kind: "model_call",
      name: `${resolved.provider}/${resolved.modelId}`,
      // Metadatos, no contenido: el texto ya queda en messages si se envia.
      output: { chars: text.length, finishReason: result.finishReason },
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    // Key invalida, cuota agotada, modelo inexistente, corte de red. El detalle
    // va al log del servidor; hacia afuera va algo legible.
    console.error(
      `[ai] fallo la generacion con ${resolved.provider}/${resolved.modelId}:`,
      error instanceof Error ? error.message : "error desconocido"
    );
    const message =
      "No se pudo generar la respuesta con IA. Conviene revisar que la API key del proveedor siga siendo valida y tenga saldo.";
    await recordTrace(supabase, request, "ai_response_failed", {
      reason: "generation_failed",
      message,
    });
    await run.step({
      kind: "model_call",
      name: `${resolved.provider}/${resolved.modelId}`,
      durationMs: Date.now() - startedAt,
      error: "generation_failed",
    });
    if (ownsRun) await run.close({ status: "error", statusDetail: "generation_failed", error: message });
    return { ok: false, problem: "generation_failed", message, runId: run.runId };
  }

  // Traza de la ejecucion. Sin el prompt ni la respuesta. Los tokens y el costo
  // van en el run (agent_runs); esto queda para las metricas que ya lo leen.
  await recordTrace(supabase, request, "ai_response_generated", {
    provider: resolved.provider ?? null,
    model: resolved.modelId ?? null,
    chars: text.length,
    contextMessages: aiMessages.length,
  });

  if (ownsRun) await run.close({ status: "completed" });

  return {
    ok: true,
    text,
    provider: resolved.provider ?? "",
    modelId: resolved.modelId ?? "",
    runId: run.runId,
  };
}

async function recordTrace(
  supabase: SupabaseClient<Database>,
  request: AiReplyRequest,
  eventType: "ai_response_generated" | "ai_response_failed",
  metadata: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from("analytics_events").insert({
    workspace_id: request.workspaceId,
    // Una secuencia no nace de un flow: la columna queda en null y la
    // procedencia se lee en metadata.source.
    flow_id: request.trace.flowId ?? null,
    contact_id: request.contactId ?? null,
    event_type: eventType,
    metadata: {
      ...metadata,
      source: request.trace.source,
      sequence_id: request.trace.sequenceId ?? null,
      enrollment_id: request.trace.enrollmentId ?? null,
    } as never,
  });

  // La traza es evidencia, no una precondicion: si no se pudo guardar, la
  // generacion igual vale.
  if (error) console.error("[ai] no pude guardar la traza:", error.message);
}
