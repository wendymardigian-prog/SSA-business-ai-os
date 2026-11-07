/**
 * Los jobs del Diseñador IA (F6). Finos a propósito: la lógica vive en
 * `lib/designer/jobs/*`, que recibe todo por parámetro y se prueba sin red.
 *
 * - `design_render`        renderiza un diseño, una generación o una exportación (sesión principal).
 * - `design_generate_many` crea N generaciones en tandas de 10 (DS6).
 * - `design_content_sync`  sube los archivos de un diseño a su pieza de Contenido (DS8).
 * - `design_ai_generate`   la IA arma o cambia un diseño (DS3).
 * - `design_cleanup`       la limpieza diaria de un negocio (sesión principal).
 *
 * NINGUNO lanza por un fallo de un proveedor (render, IA): la cola reintentaría
 * a los 10 s encima de la espera propia. Cada uno anota el error en su fila y
 * se reagenda solo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { DESIGN_AI_GENERATE_JOB, runAiGenerate } from "@/lib/designer/jobs/ai-generate";
import { DESIGN_CLEANUP_JOB, runDesignCleanup } from "@/lib/designer/jobs/cleanup";
import { DESIGN_CONTENT_SYNC_JOB, runContentSync } from "@/lib/designer/jobs/content-sync";
import { DESIGN_GENERATE_MANY_JOB, runGenerateMany } from "@/lib/designer/jobs/generate-many";
import { DESIGN_RENDER_JOB, runDesignRender, type DesignRenderPayload } from "@/lib/designer/jobs/render";

type Db = SupabaseClient<Database>;

const payloadOf = (ctx: JobContext) => (ctx.job.payload ?? {}) as Record<string, unknown>;

export async function handleDesignRender(ctx: JobContext): Promise<void> {
  const payload = payloadOf(ctx) as Partial<DesignRenderPayload>;
  if (typeof payload.designId !== "string" || !["publish", "generation", "export"].includes(payload.purpose as string)) {
    console.error("[design_render] el job no trae el diseño o el motivo");
    return;
  }
  const out = await runDesignRender(ctx.supabase as Db, payload as DesignRenderPayload);
  console.log(`[design_render] ${out.status}`);
}

export async function handleDesignCleanup(ctx: JobContext): Promise<void> {
  const workspaceId = payloadOf(ctx).workspace_id;
  if (typeof workspaceId !== "string") {
    console.error("[design_cleanup] el job no trae el negocio");
    return;
  }
  const out = await runDesignCleanup(ctx.supabase as Db, workspaceId);
  console.log(`[design_cleanup] versiones ${out.versions} · archivos ${out.files}`);
}

export function registerDesignerHandlers(): void {
  registerJobHandler(DESIGN_RENDER_JOB, handleDesignRender);
  registerJobHandler(DESIGN_GENERATE_MANY_JOB, async (ctx) => void (await runGenerateMany(ctx.supabase as Db, payloadOf(ctx))));
  registerJobHandler(DESIGN_CONTENT_SYNC_JOB, async (ctx) => void (await runContentSync(ctx.supabase as Db, payloadOf(ctx))));
  registerJobHandler(DESIGN_AI_GENERATE_JOB, async (ctx) => void (await runAiGenerate(ctx.supabase as Db, payloadOf(ctx))));
  registerJobHandler(DESIGN_CLEANUP_JOB, handleDesignCleanup);
}
