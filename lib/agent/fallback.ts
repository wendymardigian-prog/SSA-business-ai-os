import { ToolLoopAgent, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { AiModelResult } from "@/lib/ai/provider";
import type { AiRunHandle, UsageLike } from "@/lib/ai/run";

/**
 * Llamada al modelo con reintento y modelo de respaldo (F22).
 *
 *   1. Modelo principal. El AI SDK reintenta UNA vez los errores transitorios
 *      (429, 5xx, red); una key invalida no se reintenta.
 *   2. Si falla (o si el proveedor principal no esta conectado), el modelo de
 *      respaldo, con el tiempo que quede.
 *   3. Si tampoco, devuelve el fallo y quien llama deriva en silencio. El lead
 *      nunca recibe un error tecnico.
 *
 * El respaldo se resuelve con el resolvedor estricto: si su proveedor no esta
 * conectado, no hay respaldo (nunca "el primero que haya").
 */

export const MAX_AGENT_STEPS = 20;

export interface ModelRunInput {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  temperature: number | undefined;
  maxOutputTokens: number | undefined;
  timeoutMs: number;
  onStep: (step: { usage: UsageLike | undefined; finishReason: string; toolNames: string[] }) => Promise<void> | void;
}

export interface ModelRunOutput {
  text: string;
  totalUsage: UsageLike | undefined;
}

export type ModelRunner = (input: ModelRunInput) => Promise<ModelRunOutput>;

export const toolLoopRunner: ModelRunner = async (input) => {
  const agent = new ToolLoopAgent({
    model: input.model,
    instructions: input.system,
    tools: input.tools,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    maxRetries: 1,
  });
  const result = await agent.generate({
    messages: input.messages,
    abortSignal: AbortSignal.timeout(input.timeoutMs),
    onStepFinish: async (step) => {
      await input.onStep({
        usage: step.usage,
        finishReason: step.finishReason,
        toolNames: step.toolCalls.map((c) => c.toolName),
      });
    },
  });
  return { text: result.text, totalUsage: result.totalUsage };
};

export type ModelResolver = (provider: string, model: string) => Promise<AiModelResult>;

export interface Candidate {
  provider: string | null;
  model: string | null;
  role: "primary" | "fallback";
}

export type FallbackOutcome =
  | { ok: true; output: ModelRunOutput; provider: string; model: string; role: Candidate["role"] }
  | { ok: false; reason: "provider_unavailable" | "model_timeout"; attempts: Array<{ role: string; problem: string }> };

function isTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "TimeoutError" || err.name === "AbortError" || /abort|timeout/i.test(err.message);
}

export async function generateWithFallback(args: {
  candidates: Candidate[];
  resolve: ModelResolver;
  runModel: ModelRunner;
  buildInput: (model: LanguageModel) => Omit<ModelRunInput, "model" | "timeoutMs">;
  timeoutMs: number;
  /** Hasta cuando se puede seguir intentando (presupuesto de la invocacion). */
  deadline: number;
  now: () => number;
  run: AiRunHandle;
}): Promise<FallbackOutcome> {
  const attempts: Array<{ role: string; problem: string }> = [];
  let lastWasTimeout = false;

  for (const candidate of args.candidates) {
    if (!candidate.provider || !candidate.model) continue;

    const remaining = args.deadline - args.now();
    if (remaining < 15_000) {
      attempts.push({ role: candidate.role, problem: "sin tiempo para intentar" });
      break;
    }

    const resolved = await args.resolve(candidate.provider, candidate.model);
    if (!resolved.ok || !resolved.model) {
      attempts.push({ role: candidate.role, problem: resolved.problem ?? "no_provider" });
      await args.run.step({
        kind: "model_call",
        name: `${candidate.provider}/${candidate.model}`,
        error: `${candidate.role}: ${resolved.problem ?? "no_provider"}`,
      });
      lastWasTimeout = false;
      continue;
    }

    args.run.setModel(candidate.provider, candidate.model);
    const startedAt = args.now();
    try {
      const output = await args.runModel({
        ...args.buildInput(resolved.model),
        model: resolved.model,
        timeoutMs: Math.min(args.timeoutMs, remaining - 5_000),
      });
      return { ok: true, output, provider: candidate.provider, model: candidate.model, role: candidate.role };
    } catch (err) {
      lastWasTimeout = isTimeout(err);
      const problem = lastWasTimeout ? "timeout" : err instanceof Error ? err.name || "error" : "error";
      // Sin el mensaje crudo: algunos proveedores repiten parte del prompt.
      console.error(`[agent-model] fallo ${candidate.role} ${candidate.provider}/${candidate.model}: ${problem}`);
      attempts.push({ role: candidate.role, problem });
      await args.run.step({
        kind: "model_call",
        name: `${candidate.provider}/${candidate.model}`,
        durationMs: args.now() - startedAt,
        error: `${candidate.role}: ${problem}`,
      });
    }
  }

  return { ok: false, reason: lastWasTimeout ? "model_timeout" : "provider_unavailable", attempts };
}
