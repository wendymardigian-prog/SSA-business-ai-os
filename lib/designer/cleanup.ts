/**
 * Qué borra la limpieza diaria del Diseñador IA (F48b, job `design_cleanup`).
 *
 * - Versiones de MÁS de 30 días, salvo la actual (la más nueva de cada pieza) y
 *   la última de motivo `publish` de cada pieza.
 * - Exportaciones sueltas (prueba, descargas de lo no publicado, en
 *   `<ws>/<diseño>/exports/…`) de MÁS de 7 días: se vuelven a hacer si se piden.
 * - Los archivos de una GENERACIÓN nunca se borran (son lo que recibió la persona).
 *
 * Función pura: el job lee las filas, le pregunta a esta función y borra.
 */

export const VERSION_RETENTION_DAYS = 30;
export const EXPORT_RETENTION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CleanupVersion {
  id: string;
  /** La pieza a la que pertenece (`design_id` o `template_id`). */
  pieceId: string;
  createdAt: string;
  reason: "ai" | "manual" | "publish" | "restore" | "generate" | "import";
}

export interface CleanupFile {
  path: string;
  createdAt: string;
  /** Si es de una exportación suelta (`…/exports/…`). */
  isExport: boolean;
  /** Si es de una generación (certificado emitido y demás): nunca se borra. */
  isGeneration: boolean;
}

export interface CleanupPlan {
  versionIds: string[];
  paths: string[];
}

export function cleanupPlan(rows: { versions: readonly CleanupVersion[]; files: readonly CleanupFile[] }, now: Date): CleanupPlan {
  const versionCutoff = now.getTime() - VERSION_RETENTION_DAYS * DAY_MS;
  const exportCutoff = now.getTime() - EXPORT_RETENTION_DAYS * DAY_MS;

  // La actual y la última publicada de cada pieza se quedan siempre.
  const keep = new Set<string>();
  const byPiece = new Map<string, CleanupVersion[]>();
  for (const v of rows.versions) {
    const list = byPiece.get(v.pieceId) ?? [];
    list.push(v);
    byPiece.set(v.pieceId, list);
  }
  for (const list of byPiece.values()) {
    const sorted = [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
    keep.add(sorted[0].id);
    const lastPublish = sorted.find((v) => v.reason === "publish");
    if (lastPublish) keep.add(lastPublish.id);
  }

  const versionIds = rows.versions.filter((v) => !keep.has(v.id) && Date.parse(v.createdAt) < versionCutoff).map((v) => v.id);
  const paths = rows.files.filter((f) => f.isExport && !f.isGeneration && Date.parse(f.createdAt) < exportCutoff).map((f) => f.path);
  return { versionIds, paths };
}

/** Si una ruta de `design-renders` es de una exportación suelta (`<ws>/<diseño>/exports/…`). */
export function isExportPath(path: string): boolean {
  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/exports\//.test(path);
}
