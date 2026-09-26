/**
 * La llamada al modelo que escribe el guion y los captions (F29).
 *
 * Es la unica parte de F29 que habla con un proveedor. Todo lo que decide
 * algo —como se arma el pedido, si la salida sirve, como queda la pieza— vive
 * en `lib/content/ai-copy.ts`, que es puro y esta testeado.
 *
 * Se apoya en la infraestructura de IA que ya existe:
 *   - el proveedor y el modelo son los del WORKSPACE (BYOK),
 *   - el costo se registra con `openAiRun` (fuente `content_copy`),
 *   - los topes de gasto del workspace se respetan ANTES de llamar.
 *
 * Esa ultima parte importa: sin el chequeo previo, un workspace que llego a
 * su tope igual gastaria, y el tope dejaria de significar algo.
 */

import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { openAiRun } from "@/lib/ai/run";
import { withinWorkspaceBudget } from "@/lib/ai/workspace-budget";
import {
  buildPrompt,
  copyOutputSchema,
  SYSTEM_PROMPT,
  validateCopyOutput,
  type CopyRequest,
  type CopyValidation,
} from "@/lib/content/ai-copy";

type Db = SupabaseClient<Database>;

export type GenerateCopyResult =
  | (Extract<CopyValidation, { ok: true }> & { runId: string | null; costUsd: number | null })
  | { ok: false; error: string; reason: "no_provider" | "spend_limit" | "invalid_output" | "failed" };

/**
 * Genera el guion y los captions.
 *
 * `generateObject` con el esquema de Zod: se le pide al proveedor que
 * devuelva esa forma, y ademas se valida al recibirla. Las dos cosas, porque
 * "pedir" no es "garantizar".
 */
export async function generateCopy(
  supabase: Db,
  params: {
    workspaceId: string;
    userId: string;
    postId: string;
    request: CopyRequest;
  },
): Promise<GenerateCopyResult> {
  const budget = await withinWorkspaceBudget(supabase, params.workspaceId);
  if (!budget.allowed) {
    return { ok: false, reason: "spend_limit", error: budget.message ?? "Tope de gasto alcanzado" };
  }

  const resolved = await getWorkspaceModel(params.workspaceId, { supabase });
  if (!resolved.ok || !resolved.model) {
    return {
      ok: false,
      reason: "no_provider",
      error:
        resolved.message ??
        "No hay un proveedor de IA conectado. Conectalo en Integraciones para generar el guion.",
    };
  }

  const run = await openAiRun(supabase, {
    workspaceId: params.workspaceId,
    source: "content_copy",
    trigger: "manual",
  });
  run.setModel(resolved.provider!, resolved.modelId!);

  const startedAt = Date.now();
  try {
    const result = await generateObject({
      model: resolved.model,
      schema: copyOutputSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(params.request),
    });

    run.setFinalUsage(result.usage);
    await run.step({
      kind: "model_call",
      name: `${resolved.provider}/${resolved.modelId}`,
      // Metadatos, no el texto: el contenido ya queda en la pieza.
      output: { platforms: params.request.platforms.length },
      durationMs: Date.now() - startedAt,
    });

    const checked = validateCopyOutput(result.object, params.request.platforms);
    if (!checked.ok) {
      await run.close({ status: "error", statusDetail: "invalid_output", error: checked.error });
      return { ok: false, reason: "invalid_output", error: checked.error };
    }

    const closed = await run.close({ status: "responded" });
    return { ...checked, runId: run.runId, costUsd: closed.costUsd };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error desconocido";
    console.error(`[content] fallo la generacion de copy:`, detail);

    await run.step({
      kind: "model_call",
      name: `${resolved.provider}/${resolved.modelId}`,
      durationMs: Date.now() - startedAt,
      error: "generation_failed",
    });
    await run.close({ status: "error", statusDetail: "generation_failed", error: detail });

    return {
      ok: false,
      reason: "failed",
      error:
        "No pude generar el guion. Revisa que la API key del proveedor siga siendo valida y tenga saldo.",
    };
  }
}
