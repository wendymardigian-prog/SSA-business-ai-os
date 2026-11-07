/**
 * El núcleo que crea UNA generación desde una plantilla, sin sesión (DS6, F50–F56).
 *
 * Lo usan las Server Actions de `lib/actions/designer/generate.ts` (después de chequear `designer.generate` y con el
 * workspace de la SESIÓN), el job `design_generate_many` y el nodo de automatizaciones `designGenerate` (DS7). Recibe
 * el cliente de servicio: quien llama ya decidió el permiso y el workspace.
 *
 * Contrato de la Ola 2: firma definitiva; el cuerpo lo construye DS6. Nunca lanza: un error de la base o del render
 * vuelve como `{ ok: false, retryable }`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { MissingPolicy } from "./contracts";

export type GenerationSource = "manual" | "bulk" | "automation" | "module";

/**
 * Lo que se guarda en `designs.source_ref` (jsonb): de dónde salió la generación. La pestaña Generaciones arma con esto
 * "A mano · <persona>", "Automatización «<nombre>»" (con link a la corrida), "Para varios" o el módulo.
 */
export type GenerationSourceRef =
  | { kind: "user"; user_id: string }
  | { kind: "automation"; flow_id: string; session_id: string; node_id: string }
  | { kind: "bulk"; batch_id: string; user_id: string | null }
  | { kind: "module"; module: string; id: string };

export interface CreateGenerationInput {
  workspaceId: string;
  templateId: string;
  contactId: string | null;
  subjectRef?: { module: string; type: string; id: string; label: string } | null;
  /** Lo que se pasa a mano o desde la automatización (gana sobre el sujeto y el valor por defecto). */
  overrides: Record<string, string>;
  /** Si falta un dato (F55). En automatizaciones, `fail` por defecto. */
  policy: MissingPolicy;
  publish: boolean;
  source: GenerationSource;
  /** De dónde salió (va a `designs.source_ref`). Su `kind` acompaña a `source`. */
  sourceRef: GenerationSourceRef | null;
  /** Si ya tiene una válida y la plantilla verifica: true = anular la anterior y generar otra; false = devolver `existing`. */
  replaceExisting?: boolean;
  /** Quien la pidió (para el historial); null si es automática. */
  actorUserId: string | null;
  /**
   * `true` (por defecto): encola el render (`design_render`, `purpose: "generation"`). `false`: NO lo encola, porque
   * quien llama lo corre en el momento (el nodo de automatizaciones con "Esperar el PDF antes de seguir", F57) y una
   * segunda corrida en la cola renderizaría dos veces.
   */
  enqueueRender?: boolean;
}

export type CreateGenerationResult =
  | {
      ok: true;
      designId: string;
      code: string;
      /** `queued`: el render quedó encolado. `failed`: faltó un dato con la política `fail` (la fila queda con el motivo). */
      status: "queued" | "failed";
      missing: { key: string; label: string }[];
    }
  | { ok: false; reason: "existing"; existing: { designId: string; code: string } }
  | { ok: false; reason: "error"; error: string; retryable: boolean };

export async function createGeneration(_db: SupabaseClient<Database>, _input: CreateGenerationInput): Promise<CreateGenerationResult> {
  return { ok: false, reason: "error", error: "Todavía no está construido (Ola 3)", retryable: false };
}
