import { ToolLoopAgent, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { AiModelResult } from "@/lib/ai/provider";
import type { AiRunHandle, UsageLike } from "@/lib/ai/run";
import { classifyModelError, isTimeoutError } from "./model-error";

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
 *
 * UNA EXCEPCION AL PASO 2: si el principal fallo con 401/403, el respaldo DEL
 * MISMO PROVEEDOR no se intenta. La key es del proveedor, no del modelo: si
 * Anthropic rechazo la key con Sonnet, la va a rechazar con Haiku. Intentarlo
 * gasta tiempo del presupuesto del turno y deja dos errores identicos en la
 * pantalla, que fue exactamente lo que confundio el diagnostico la primera vez.
 * Un respaldo de OTRO proveedor si se intenta: esa es la razon de tenerlo.
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

/** Un intento, para el detalle del run. `problem` nunca trae texto del lead. */
export interface FallbackAttempt {
  role: string;
  provider: string | null;
  model: string | null;
  problem: string;
}

/** Un proveedor que rechazo la key. Lo usa quien llama para avisar. */
export interface ProviderAuthFailure {
  provider: string;
  model: string;
  status: number;
}

export type FallbackOutcome =
  | { ok: true; output: ModelRunOutput; provider: string; model: string; role: Candidate["role"] }
  | {
      ok: false;
      reason: "provider_unavailable" | "model_timeout";
      attempts: FallbackAttempt[];
      /** Los proveedores que rechazaron la key en este turno. */
      authFailures: ProviderAuthFailure[];
    };

/**
 * El resumen de los intentos que se guarda en `agent_runs.error`.
 *
 * Lleva proveedor y modelo, no solo el rol: "primary: AI_APICallError" no
 * decia contra que se habia intentado.
 */
export function describeAttempts(attempts: FallbackAttempt[]): string {
  return attempts
    .map((a) => `${a.role} ${a.provider ?? "?"}/${a.model ?? "?"}: ${a.problem}`)
    .join("; ");
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
  const attempts: FallbackAttempt[] = [];
  const authFailures: ProviderAuthFailure[] = [];
  /** Los proveedores que ya rechazaron la key en este turno. */
  const keyRejectedBy = new Set<string>();
  let lastWasTimeout = false;

  const note = async (candidate: Candidate, problem: string, durationMs?: number) => {
    attempts.push({ role: candidate.role, provider: candidate.provider, model: candidate.model, problem });
    await args.run.step({
      kind: "model_call",
      name: `${candidate.provider}/${candidate.model}`,
      ...(durationMs === undefined ? {} : { durationMs }),
      error: `${candidate.role}: ${problem}`,
    });
  };

  for (const candidate of args.candidates) {
    if (!candidate.provider || !candidate.model) continue;

    // El proveedor ya rechazo la key con el modelo anterior. La key es del
    // proveedor, no del modelo: volver a intentar da el mismo 401.
    if (keyRejectedBy.has(candidate.provider)) {
      await note(candidate, "skipped_same_provider_auth");
      lastWasTimeout = false;
      continue;
    }

    const remaining = args.deadline - args.now();
    if (remaining < 15_000) {
      attempts.push({ role: candidate.role, provider: candidate.provider, model: candidate.model, problem: "sin tiempo para intentar" });
      break;
    }

    const resolved = await args.resolve(candidate.provider, candidate.model);
    if (!resolved.ok || !resolved.model) {
      await note(candidate, resolved.problem ?? "no_provider");
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
      const failure = classifyModelError(err);
      lastWasTimeout = failure.isTimeout;
      if (failure.isAuth) {
        keyRejectedBy.add(candidate.provider);
        authFailures.push({ provider: candidate.provider, model: candidate.model, status: failure.status ?? 401 });
      }
      // Sin el mensaje crudo: algunos proveedores repiten parte del prompt.
      console.error(`[agent-model] fallo ${candidate.role} ${candidate.provider}/${candidate.model}: ${failure.code}`);
      await note(candidate, failure.code, args.now() - startedAt);
    }
  }

  return {
    ok: false,
    reason: lastWasTimeout ? "model_timeout" : "provider_unavailable",
    attempts,
    authFailures,
  };
}
