/**
 * De dónde sale el modelo del Diseñador IA y cómo se le habla (F32).
 *
 * - El modelo es el del NEGOCIO (BYOK, `getWorkspaceModel`): se prefiere
 *   Anthropic y, si no está conectado, el primero con visión (OpenAI o Google).
 *   Los tres ven imágenes. Sin ninguno: «Conectá una clave de IA en
 *   Configuración» y el resto del Diseñador sigue andando.
 * - Hablar con el modelo es UNA función inyectable (`DesignerGenerate`): los
 *   tests pasan un doble y ninguna lógica del módulo conoce al proveedor. La
 *   real (`aiSdkDesignerGenerate`) usa `generateObject` con salida validada por
 *   Zod y manda las imágenes como `{ type: "image", image: bytes, mediaType }`.
 * - Con Anthropic se pide la salida por una herramienta JSON (`jsonTool`), no
 *   la salida estructurada nativa: la nativa acepta hasta 24 campos opcionales
 *   en el esquema y el documento del Diseñador tiene más (11/11/2026, Anthropic
 *   rechazaba cada pedido con «too many optional parameters (40)»). La respuesta
 *   se sigue validando con Zod, así que no se pierde ninguna garantía.
 *
 * Solo servidor.
 */

import { generateObject, type LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { getWorkspaceModel } from "@/lib/ai/provider";
import type { UsageLike } from "@/lib/ai/run";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/** Los proveedores con visión, en orden de preferencia para diseñar. */
export const DESIGNER_PROVIDERS = ["anthropic", "openai", "google_ai"] as const;

/** El aviso cuando el negocio no tiene ninguna IA conectada. */
export const NO_AI_MESSAGE = "Conectá una clave de IA en Configuración";

export interface DesignerImage {
  bytes: Uint8Array;
  mediaType: string;
}

export interface DesignerGenerateArgs<T> {
  system: string;
  text: string;
  images: readonly DesignerImage[];
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}

export interface DesignerGenerateResult<T> {
  object: T;
  usage?: UsageLike;
}

export type DesignerGenerate = <T>(args: DesignerGenerateArgs<T>) => Promise<DesignerGenerateResult<T>>;

/** El error que se lanza cuando el modelo corta la respuesta por largo (no se reintenta). */
export class TruncatedOutputError extends Error {
  constructor() {
    super("respuesta_cortada: la respuesta del modelo se cortó por largo");
    this.name = "TruncatedOutputError";
  }
}

/**
 * Opciones por proveedor que viajan en cada pedido del Diseñador. Los proveedores que no son
 * Anthropic ignoran la clave `anthropic`.
 */
export const DESIGNER_PROVIDER_OPTIONS = { anthropic: { structuredOutputMode: "jsonTool" } } as const;

/** `DesignerGenerate` con el AI SDK. */
export function aiSdkDesignerGenerate(model: LanguageModel): DesignerGenerate {
  return async <T>(args: DesignerGenerateArgs<T>) => {
    try {
      const result = await generateObject({
        model,
        system: args.system,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: args.text }, ...args.images.map((img) => ({ type: "image" as const, image: img.bytes, mediaType: img.mediaType }))],
          },
        ],
        schema: args.schema,
        maxOutputTokens: args.maxOutputTokens ?? 12_000,
        providerOptions: DESIGNER_PROVIDER_OPTIONS,
      });
      return { object: result.object as T, usage: result.usage };
    } catch (error) {
      if ((error as { finishReason?: string } | null)?.finishReason === "length") throw new TruncatedOutputError();
      throw error;
    }
  };
}

export type DesignerModel =
  | { ok: true; model: LanguageModel; provider: string; modelId: string }
  | { ok: false; problem: "no_provider" | "failed"; message: string };

/** El modelo del negocio para diseñar: Anthropic primero, después cualquiera con visión. Nunca devuelve la clave. */
export async function resolveDesignerModel(workspaceId: string, supabase: Db): Promise<DesignerModel> {
  let sawProblem: string | null = null;
  for (const provider of DESIGNER_PROVIDERS) {
    const attempt = await getWorkspaceModel(workspaceId, { preferredProvider: provider, supabase: supabase as never });
    if (attempt.ok && attempt.model && attempt.provider === provider && attempt.modelId) {
      return { ok: true, model: attempt.model, provider, modelId: attempt.modelId };
    }
    if (!attempt.ok && attempt.problem && attempt.problem !== "no_provider") sawProblem = attempt.message ?? null;
  }
  if (sawProblem) return { ok: false, problem: "failed", message: sawProblem };
  return { ok: false, problem: "no_provider", message: NO_AI_MESSAGE };
}

/**
 * Si el negocio tiene alguna IA de texto conectada (sin leer ninguna clave): para decir «Conectá una clave de IA»
 * apenas se pide, sin esperar a la cola. Ante un error de lectura devuelve `true` (que decida el job).
 */
export async function hasConnectedAi(workspaceId: string, supabase: Db): Promise<boolean> {
  const { data, error } = await supabase.from("integration_configs").select("provider").eq("workspace_id", workspaceId).eq("type", "ai_provider").eq("is_active", true);
  if (error) return true;
  return (data ?? []).some((row) => (DESIGNER_PROVIDERS as readonly string[]).includes(row.provider));
}
