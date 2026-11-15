// @plantilla-quitar(servicios)
/**
 * «Copiar a otro programa» (F50), puro: qué se copia y en qué orden. Un módulo se copia con sus submódulos y clases
 * (primero el padre, después los hijos, en su orden); una clase, sola. Las copias son NUEVAS: nunca se comparte una
 * clase, un formulario ni un archivo entre programas.
 */
export interface CopySource {
  id: string;
  parent_id: string | null;
  kind: "module" | "submodule" | "lesson";
  position: number;
}

/** Los ítems a copiar, padres antes que hijos. Vacío si el ítem no está. */
export function copyPlan<T extends CopySource>(items: readonly T[], rootId: string): T[] {
  const root = items.find((i) => i.id === rootId);
  if (!root) return [];
  const out: T[] = [root];
  const visit = (parentId: string) => {
    for (const c of items.filter((i) => i.parent_id === parentId).sort((a, b) => a.position - b.position)) {
      out.push(c);
      visit(c.id);
    }
  };
  visit(root.id);
  return out;
}

/** Las rutas de archivos de un ítem (documento, portada, miniatura y recursos): todas se copian a rutas nuevas. */
export function filePaths(i: { document_path?: string | null; cover_path?: string | null; thumbnail_path?: string | null; resources?: unknown }): string[] {
  const res = Array.isArray(i.resources) ? (i.resources as Array<{ path?: unknown }>).map((r) => r?.path).filter((p): p is string => typeof p === "string" && p !== "") : [];
  return [i.document_path, i.cover_path, i.thumbnail_path].filter((p): p is string => typeof p === "string" && p !== "").concat(res);
}

/** La ruta nueva de un archivo copiado, en la carpeta del ítem nuevo (mismo nombre de archivo). */
export function copiedPath(oldPath: string, workspaceId: string, productId: string, itemId: string): string {
  const name = oldPath.split("/").pop() ?? "archivo";
  return `${workspaceId}/${productId}/${itemId}/${name}`;
}
