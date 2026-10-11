/**
 * Clasificar una llamada con IA: arma el pedido, llama a `generate` (inyectada)
 * y decide que hacer con la respuesta. No toca la base ni habla con ningun
 * proveedor: el handler `call_classify` es quien guarda.
 *
 * Reglas de la decision (F18):
 *  - un tipo que no esta entre los validos NO se acepta: `otra` + revision;
 *  - confianza por debajo del umbral: queda "por revisar";
 *  - `tipo_propuesto` solo vale con `allow_ai_types` y si no esta descartado ni
 *    ya existe como tipo valido, y solo cuando el tipo es `otra`.
 */
import { newNonce } from "@/lib/agent/untrusted";
import type { GenerateFn } from "./ai-generate";
import { buildClassifierSystem, buildClassifierUser, classifierSchema, type ClassifierOutput } from "./classifier-prompt";
import { slugKey } from "./rubric";
import { validTypeKeys, type CallClassificationSettings } from "./task-settings";
import type { UsageLike } from "@/lib/ai/run";

export interface ClassifyDecision {
  type: string;
  confidence: number;
  alternative: string | null;
  reason: string;
  /** Nombre corto de un tipo nuevo que propone el modelo, o null. */
  proposed: string | null;
  lowConfidence: boolean;
  /** El modelo contesto un tipo que no existe: se trato como `otra`. */
  invalidType: boolean;
}

export function decideClassification(output: ClassifierOutput, settings: CallClassificationSettings): ClassifyDecision {
  const valid = validTypeKeys(settings.custom_types);
  const known = (k: string | null | undefined): k is string => !!k && valid.includes(k);

  const invalidType = !known(output.tipo);
  const type = invalidType ? "otra" : output.tipo;
  const alternative = known(output.alternativa) && output.alternativa !== type ? output.alternativa : null;

  let proposed: string | null = null;
  const raw = output.tipo_propuesto?.trim();
  if (settings.allow_ai_types && type === "otra" && raw) {
    const key = slugKey(raw);
    const discarded = settings.discarded_types.map((d) => slugKey(d));
    if (key && !valid.includes(key) && !discarded.includes(key)) proposed = raw.slice(0, 60);
  }

  const confidence = invalidType ? Math.min(output.confianza, 0.3) : output.confianza;
  return {
    type,
    confidence: Math.round(confidence * 100) / 100,
    alternative,
    reason: output.motivo.trim().slice(0, 500),
    proposed,
    lowConfidence: invalidType || confidence < settings.confidence_threshold,
    invalidType,
  };
}

export type ClassifyResult =
  | { ok: true; decision: ClassifyDecision; usage?: UsageLike; system: string }
  | { ok: false; error: string; cause: unknown };

export async function classifyCallWithAi(input: {
  call: { title: string; attendees: unknown; transcript: unknown };
  settings: CallClassificationSettings;
  /** El texto editable activo (o el del sistema). */
  instructions: string;
  generate: GenerateFn;
  nonce?: string;
}): Promise<ClassifyResult> {
  const system = buildClassifierSystem(input.instructions, {
    customTypes: input.settings.custom_types,
    allowAiTypes: input.settings.allow_ai_types,
    discardedTypes: input.settings.discarded_types,
  });
  const prompt = buildClassifierUser(input.call, input.nonce ?? newNonce());
  try {
    const result = await input.generate({ system, prompt, schema: classifierSchema, maxOutputTokens: 600 });
    return { ok: true, decision: decideClassification(result.object, input.settings), usage: result.usage, system };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "error desconocido", cause: error };
  }
}
