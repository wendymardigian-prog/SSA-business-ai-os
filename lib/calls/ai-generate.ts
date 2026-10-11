/**
 * La unica forma en que las funciones de Llamadas piden algo a un modelo:
 * `generate({ system, prompt, schema })`. Quien llama la INYECTA (el handler
 * con el modelo real, el test con un doble), asi ninguna logica de este modulo
 * habla con un proveedor ni se puede probar contra uno por accidente.
 */
import { generateObject, type LanguageModel } from "ai";
import type { z } from "zod";
import type { UsageLike } from "@/lib/ai/run";

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
  constructor() {
    super("respuesta_cortada: la respuesta del modelo se cortó por largo");
    this.name = "TruncatedOutputError";
  }
}

/** `generate` con el AI SDK. Una respuesta cortada por largo se distingue de una respuesta mal formada. */
export function aiSdkGenerate(model: LanguageModel): GenerateFn {
  return async <T>(args: GenerateArgs<T>) => {
    try {
      const result = await generateObject({
        model,
        system: args.system,
        prompt: args.prompt,
        schema: args.schema,
        maxOutputTokens: args.maxOutputTokens,
      });
      return { object: result.object as T, usage: result.usage };
    } catch (error) {
      const finish = (error as { finishReason?: string } | null)?.finishReason;
      if (finish === "length") throw new TruncatedOutputError();
      throw error;
    }
  };
}
