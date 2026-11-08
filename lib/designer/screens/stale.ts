/**
 * «Hay cambios sin publicar» (F48b): un diseño publicado que se editó después de publicar muestra, en su link, la versión
 * anterior. Guardar NO vuelve a renderizar: se republica a mano con «Publicar cambios».
 *
 * La regla compara el documento vigente con el que quedó en la última versión `publish` (publicar guarda una copia del
 * documento tal como salió). No usa fechas: `updated_at` también cambia cuando termina un render o se cambia una opción,
 * y `published_at` solo guarda la PRIMERA publicación; compararlas daría avisos falsos. Para la pantalla, mientras se
 * edita: lo que difiere de lo que cargó el servidor también cuenta.
 *
 * Módulo puro.
 */

/** JSON con las claves ordenadas: dos documentos iguales dan el mismo texto sin importar el orden de las claves. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Del lado del servidor: un diseño publicado cuyo documento difiere del de su última versión de publicar. Sin versión
 * de publicar (un diseño viejo, o el guardado de la versión falló) no se puede saber: no avisa.
 */
export function differsFromPublished(args: { published: boolean; doc: unknown; publishedDoc: unknown | null }): boolean {
  if (!args.published || args.publishedDoc === null || args.publishedDoc === undefined) return false;
  return stableStringify(args.doc) !== stableStringify(args.publishedDoc);
}

/**
 * Lo que decide el editor: publicado y (el servidor ya lo veía distinto, o se guardó otra revisión después de cargar la
 * pantalla, o hay cambios sin guardar). Después de «Publicar cambios» el servidor devuelve `serverDiffers = false` y la
 * revisión que carga la pantalla alcanza a la guardada, así que el aviso se apaga solo.
 */
export function hasUnpublishedChanges(args: { published: boolean; isGeneration: boolean; serverDiffers: boolean; loadedRev: number; currentRev: number; dirty: boolean }): boolean {
  if (!args.published || args.isGeneration) return false;
  return args.serverDiffers || args.currentRev !== args.loadedRev || args.dirty;
}
