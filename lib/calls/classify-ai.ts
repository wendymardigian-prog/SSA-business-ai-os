/**
 * Clasificar una llamada con IA: arma el pedido, llama a `generate` (inyectada)
 * y decide que hacer con la respuesta. No toca la base ni habla con ningun
 * proveedor: el handler `call_classify` es quien guarda.
 *
 * Reglas de la decision (F18):
 *  - la IA elige solo entre las areas y tipos activos de la lista: lo que no esta no
 *    se acepta y la llamada queda sin clasificar, para que la elija una persona;
 *  - confianza por debajo del umbral: queda "por revisar".
 */
import { newNonce } from "@/lib/agent/untrusted";
import type { GenerateFn } from "./ai-generate";
import type { ClassifierOption } from "./catalog";
import { buildClassifierSystem, buildClassifierUser, classifierSchema, type ClassifierOutput } from "./classifier-prompt";
import type { UsageLike } from "@/lib/ai/run";

export interface ClassifyDecision {
  /** Lo que eligio la IA, o null si contesto algo que no esta en la lista. */
  categoryId: string | null;
  confidence: number;
  alternative: string | null;
  reason: string;
  lowConfidence: boolean;
  /** El modelo contesto una opcion que no existe. */
  invalidType: boolean;
}

export function decideClassification(output: ClassifierOutput, options: ClassifierOption[], confidenceThreshold: number): ClassifyDecision {
  const find = (label: string | null | undefined) => options.find((o) => o.label === label?.trim());
  const chosen = find(output.tipo);
  const invalidType = !chosen;
  const other = find(output.alternativa);
  const alternative = other && other.categoryId !== chosen?.categoryId ? other.label : null;
  const confidence = invalidType ? Math.min(output.confianza, 0.3) : output.confianza;
  return {
    categoryId: chosen?.categoryId ?? null,
    confidence: Math.round(confidence * 100) / 100,
    alternative,
    reason: output.motivo.trim().slice(0, 500),
    lowConfidence: invalidType || confidence < confidenceThreshold,
    invalidType,
  };
}

export type ClassifyResult =
  | { ok: true; decision: ClassifyDecision; usage?: UsageLike; system: string }
  | { ok: false; error: string; cause: unknown };

export async function classifyCallWithAi(input: {
  call: { title: string; attendees: unknown; transcript: unknown };
  options: ClassifierOption[];
  confidenceThreshold: number;
  /** El texto editable activo (o el del sistema). */
  instructions: string;
  generate: GenerateFn;
  nonce?: string;
}): Promise<ClassifyResult> {
  const system = buildClassifierSystem(input.instructions, input.options);
  const prompt = buildClassifierUser(input.call, input.nonce ?? newNonce());
  try {
    const result = await input.generate({ system, prompt, schema: classifierSchema, maxOutputTokens: 600 });
    return { ok: true, decision: decideClassification(result.object, input.options, input.confidenceThreshold), usage: result.usage, system };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "error desconocido", cause: error };
  }
}
