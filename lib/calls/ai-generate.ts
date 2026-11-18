/**
 * La unica forma en que las funciones de Llamadas piden algo a un modelo:
 * `generate({ system, prompt, schema })`. Quien llama la INYECTA (el handler
 * con el modelo real, el test con un doble), asi ninguna logica de este modulo
 * habla con un proveedor ni se puede probar contra uno por accidente.
 */
import { generateObject, type LanguageModel } from "ai";
import type { z } from "zod";
import type { UsageLike } from "@/lib/ai/run";
import { STRUCTURED_OUTPUT_PROVIDER_OPTIONS } from "@/lib/ai/structured-output";

export interface GenerateArgs<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}

export interface GenerateResult<T> {
  object: T;
  usage?: UsageLike;
}

export type GenerateFn = <T>(args: GenerateArgs<T>) => Promise<GenerateResult<T>>;

/** El error que lanza `generate` cuando el modelo corto la respuesta por largo. */
export class TruncatedOutputError extends Error {
  /** Lo que se gastó igual en el intento cortado (el proveedor lo cobra). */
  readonly usage?: UsageLike;
  constructor(usage?: UsageLike) {
    super("respuesta_cortada: la respuesta del modelo se cortó por largo");
    this.name = "TruncatedOutputError";
    this.usage = usage;
  }
}

/**
 * Lo gastado en un intento que falló, si el error lo trae (una respuesta
 * cortada o que no cumplió el esquema igual se cobró). Sin dato: undefined.
 */
export function usageOfFailure(error: unknown): UsageLike | undefined {
  const usage = (error as { usage?: unknown } | null)?.usage;
  return usage && typeof usage === "object" ? (usage as UsageLike) : undefined;
}

/**
 * `generate` con el AI SDK. Una respuesta cortada por largo se distingue de una
 * respuesta mal formada. Con Anthropic la salida va por una herramienta JSON
 * (ver `STRUCTURED_OUTPUT_PROVIDER_OPTIONS`): el esquema del análisis tiene más
 * campos opcionales de los que acepta la salida nativa.
 */
export function aiSdkGenerate(model: LanguageModel): GenerateFn {
  return async <T>(args: GenerateArgs<T>) => {
    try {
      const result = await generateObject({
        model,
        system: args.system,
        prompt: args.prompt,
        schema: args.schema,
        maxOutputTokens: args.maxOutputTokens,
        providerOptions: STRUCTURED_OUTPUT_PROVIDER_OPTIONS,
      });
      return { object: result.object as T, usage: result.usage };
    } catch (error) {
      const finish = (error as { finishReason?: string } | null)?.finishReason;
      if (finish === "length") throw new TruncatedOutputError(usageOfFailure(error));
      throw error;
    }
  };
}
