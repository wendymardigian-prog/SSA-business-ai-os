/**
 * F48b: un solo juego de archivos por diseño propio. Al volver a renderizar (publicar de nuevo, o después de un
 * cambio), el job sube los archivos nuevos, actualiza `renders` y recién ahí llama a esta función, que borra del
 * bucket `design-renders` los archivos del juego anterior que ya no se usan.
 *
 * - Solo se borra lo que dice `renders` del juego anterior (`pages` y `pdf_path`), nunca nada que no esté ahí.
 * - Nunca un archivo del juego nuevo (si una ruta se repitiera, se queda).
 * - Nunca nada fuera de la carpeta de ESTE diseño (`<negocio>/<diseño>/…`) ni de las exportaciones sueltas
 *   (`…/exports/…`, que limpia `design_cleanup` a los 7 días).
 * - Las GENERACIONES nunca llegan acá: conservan sus archivos para siempre (el job no la llama para ellas).
 * - Nunca lanza: si no se puede borrar, queda en el log y el archivo sobrante solo ocupa lugar (nunca se pierde
 *   nada que el diseño use: el juego nuevo ya está guardado cuando esto corre).
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { DESIGN_RENDERS_BUCKET } from "../storage";
import type { RenderSet } from "./render";

/** Las rutas de un juego de archivos guardado (`renders`), sin fiarse de su forma. */
function pathsOf(set: unknown): string[] {
  if (!set || typeof set !== "object" || Array.isArray(set)) return [];
  const { pages, pdf_path: pdf } = set as { pages?: unknown; pdf_path?: unknown };
  const paths: string[] = Array.isArray(pages) ? pages.filter((p): p is string => typeof p === "string") : [];
  if (typeof pdf === "string") paths.push(pdf);
  return paths;
}

/** `<negocio>/<diseño>/`: la carpeta a la que pertenece el juego nuevo. */
function ownerPrefix(next: Pick<RenderSet, "pdf_path" | "pages">): string | null {
  const sample = next.pdf_path ?? next.pages[0];
  if (!sample) return null;
  const segments = sample.split("/");
  return segments.length >= 3 ? `${segments[0]}/${segments[1]}/` : null;
}

/** Qué archivos del juego anterior hay que borrar al guardar el nuevo. Puro. */
export function previousRendersToDelete(previous: unknown, next: Pick<RenderSet, "pdf_path" | "pages">): string[] {
  const owner = ownerPrefix(next);
  if (!owner) return [];
  const keep = new Set(pathsOf(next));
  const doomed = pathsOf(previous).filter(
    (path) => path.startsWith(owner) && !path.includes("..") && !path.includes("//") && !path.slice(owner.length).startsWith("exports/") && !keep.has(path),
  );
  return [...new Set(doomed)];
}

export async function releasePreviousRenders(db: SupabaseClient<Database>, previous: unknown, next: RenderSet): Promise<void> {
  try {
    const paths = previousRendersToDelete(previous, next);
    if (paths.length === 0) return;
    const { error } = await db.storage.from(DESIGN_RENDERS_BUCKET).remove(paths);
    if (error) console.error("[design_render] no pude borrar los archivos del juego anterior:", error.message);
  } catch (error) {
    console.error("[design_render] no pude borrar los archivos del juego anterior:", error instanceof Error ? error.message : "error");
  }
}
