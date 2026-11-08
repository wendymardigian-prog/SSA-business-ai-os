/**
 * El job `design_cleanup` (F48b): la limpieza diaria de un negocio.
 *
 * Lo encola el cron SQL `design-cleanup` (`private.enqueue_design_cleanup`,
 * 00320) solo si el negocio tiene algo para limpiar. Qué se borra lo decide
 * `cleanupPlan` (puro): versiones de más de 30 días (salvo la actual y la última
 * publicada) y exportaciones sueltas de más de 7 días. Los archivos de las
 * generaciones nunca se tocan (no viven en `exports/`).
 *
 * Nunca lanza: lo que no pudo borrar queda para la vuelta del día siguiente.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { cleanupPlan, type CleanupFile, type CleanupVersion } from "../cleanup";
import { DESIGN_RENDERS_BUCKET } from "../storage";

export const DESIGN_CLEANUP_JOB = "design_cleanup";

type Db = SupabaseClient<Database>;

const PAGE = 1000;
const MAX_FOLDERS = 2000;

async function loadVersions(db: Db, workspaceId: string): Promise<CleanupVersion[]> {
  const out: CleanupVersion[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await db
      .from("design_versions")
      .select("id, design_id, template_id, created_at, reason")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const v of data ?? []) out.push({ id: v.id, pieceId: (v.design_id ?? v.template_id) as string, createdAt: v.created_at, reason: v.reason });
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Las exportaciones sueltas: `<ws>/<diseño>/exports/<marca>/<archivo>`. */
async function loadExports(db: Db, workspaceId: string): Promise<CleanupFile[]> {
  const bucket = db.storage.from(DESIGN_RENDERS_BUCKET);
  const files: CleanupFile[] = [];
  const { data: designs } = await bucket.list(workspaceId, { limit: MAX_FOLDERS });
  for (const design of designs ?? []) {
    const { data: stamps } = await bucket.list(`${workspaceId}/${design.name}/exports`, { limit: MAX_FOLDERS });
    for (const stamp of stamps ?? []) {
      const folder = `${workspaceId}/${design.name}/exports/${stamp.name}`;
      const { data: inside } = await bucket.list(folder, { limit: 100 });
      for (const file of inside ?? []) {
        if (!file.id) continue;
        files.push({ path: `${folder}/${file.name}`, createdAt: file.created_at ?? new Date(0).toISOString(), isExport: true, isGeneration: false });
      }
    }
  }
  return files;
}

export async function runDesignCleanup(db: Db, workspaceId: string, now: Date = new Date()): Promise<{ versions: number; files: number }> {
  try {
    const plan = cleanupPlan({ versions: await loadVersions(db, workspaceId), files: await loadExports(db, workspaceId) }, now);
    for (let i = 0; i < plan.versionIds.length; i += 200) {
      const { error } = await db.from("design_versions").delete().in("id", plan.versionIds.slice(i, i + 200)).eq("workspace_id", workspaceId);
      if (error) console.error("[design_cleanup] no pude borrar versiones:", error.message);
    }
    for (let i = 0; i < plan.paths.length; i += 100) {
      const { error } = await db.storage.from(DESIGN_RENDERS_BUCKET).remove(plan.paths.slice(i, i + 100));
      if (error) console.error("[design_cleanup] no pude borrar archivos:", error.message);
    }
    return { versions: plan.versionIds.length, files: plan.paths.length };
  } catch (error) {
    console.error("[design_cleanup] falló la limpieza:", error instanceof Error ? error.message : "error");
    return { versions: 0, files: 0 };
  }
}
