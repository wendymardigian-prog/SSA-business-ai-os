/**
 * Los editores de pasos de Formularios y Agenda (y el de fin de día) guardan y activan al instante: no pasan por el
 * borrador del lienzo. Dos reglas para que convivan con él (00508):
 *
 *  - Si la automatización tiene cambios sin publicar en el LIENZO, no se guarda desde acá: el próximo «Publicar
 *    cambios» del lienzo pisaría lo que se guardó, sin avisar. Se pide publicarlos o descartarlos primero.
 *  - Cada guardado de una automatización publicada queda en el historial de versiones, igual que publicar.
 *
 * Nunca lanza: leer el borrador mal no deja guardar (ante la duda, no se pisa nada); el historial es un extra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/types/database";

type Db = SupabaseClient<any, any, any>;

export const CANVAS_DRAFT_BLOCK =
  "Esta automatización tiene cambios sin publicar en el lienzo. Abrila en Automatizaciones y publicalos o descartalos antes de guardar desde acá.";

/** El motivo para no guardar, o null si se puede. */
export async function canvasDraftBlock(db: Db, flowId: string): Promise<string | null> {
  const { data, error } = await db.from("flows").select("status, draft_nodes").eq("id", flowId).maybeSingle();
  if (error) return "No pude revisar si hay cambios sin publicar. Probá de nuevo.";
  const row = (data ?? {}) as { status?: string; draft_nodes?: unknown };
  return row.status === "published" && Array.isArray(row.draft_nodes) ? CANVAS_DRAFT_BLOCK : null;
}

/** Deja el guardado en el historial (versión nueva). Solo si la automatización está publicada. Nunca lanza. */
export async function recordStepEditorVersion(db: Db, input: { flowId: string; nodes: unknown[]; edges: unknown[]; userId: string | null }): Promise<void> {
  try {
    const { data: flow, error } = await db.from("flows").select("status, version, name, viewport").eq("id", input.flowId).maybeSingle();
    if (error || !flow) return;
    const row = flow as { status: string; version: number; name: string; viewport: Json | null };
    if (row.status !== "published") return;
    const next = (row.version ?? 0) + 1;
    // Condicional sobre la versión: dos guardados a la vez no crean la misma.
    const { data: bumped } = await db
      .from("flows")
      .update({ version: next, published_at: new Date().toISOString() })
      .eq("id", input.flowId)
      .eq("version", row.version)
      .select("id")
      .maybeSingle();
    if (!bumped) return;
    const { error: insertError } = await db.from("flow_versions").insert({
      flow_id: input.flowId,
      version: next,
      nodes: input.nodes as Json,
      edges: input.edges as Json,
      viewport: row.viewport,
      name: row.name,
      published_by: input.userId,
    });
    if (insertError) console.error("[flows] no pude guardar la versión del editor de pasos:", insertError.message);
  } catch (error) {
    console.error("[flows] no pude guardar la versión del editor de pasos:", error instanceof Error ? error.message : "error");
  }
}
