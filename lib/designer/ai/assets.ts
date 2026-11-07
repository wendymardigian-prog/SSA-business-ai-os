/**
 * Los nombres cortos de las imágenes que ve la IA (F32).
 *
 * Una ruta del Storage es un uuid largo que un modelo puede deformar al
 * copiarlo. A la IA se le habla de `imagen_1`, `imagen_2`…: las adjuntas del
 * pedido primero y después las que ya usa el documento. Lo que vuelve se
 * traduce otra vez a rutas reales, y una ruta que no es del negocio o un
 * nombre que no existe no pasa nunca.
 *
 * Módulo puro.
 */

import type { DesignDoc } from "../doc/schema";

/** Si una ruta es del negocio (primer segmento = workspace) y no intenta salirse de su carpeta. */
function belongsTo(path: string, workspaceId: string): boolean {
  if (path.includes("..") || path.includes("//") || path.startsWith("/")) return false;
  return path.split("/")[0] === workspaceId;
}

export const ALIAS_RE = /^imagen_\d{1,3}$/;

export class AssetAliases {
  private readonly toAlias = new Map<string, string>();
  private readonly toPath = new Map<string, string>();

  constructor(
    private readonly workspaceId: string,
    attachments: readonly string[] = [],
    doc?: DesignDoc,
  ) {
    for (const path of attachments) this.add(path);
    if (doc) for (const path of docAssets(doc)) this.add(path);
  }

  private add(path: string): string {
    const existing = this.toAlias.get(path);
    if (existing) return existing;
    const alias = `imagen_${this.toAlias.size + 1}`;
    this.toAlias.set(path, alias);
    this.toPath.set(alias, path);
    return alias;
  }

  /** El nombre corto de una ruta conocida; `null` si no se registró. */
  aliasFor(path: string): string | null {
    return this.toAlias.get(path) ?? null;
  }

  /** Todas las imágenes registradas: alias y ruta, en orden. */
  entries(): { alias: string; path: string }[] {
    return [...this.toAlias.entries()].map(([path, alias]) => ({ alias, path }));
  }

  /**
   * La ruta real de lo que escribió la IA: un nombre corto conocido, o una ruta
   * del propio negocio copiada tal cual. Cualquier otra cosa devuelve `null`.
   */
  resolve(value: string): string | null {
    const trimmed = value.trim();
    const known = this.toPath.get(trimmed);
    if (known) return known;
    if (!ALIAS_RE.test(trimmed) && belongsTo(trimmed, this.workspaceId)) return trimmed;
    return null;
  }

  /** Una copia del documento con los nombres cortos en lugar de las rutas (lo que se le muestra a la IA). */
  aliasDoc(doc: DesignDoc): DesignDoc {
    const copy = structuredClone(doc);
    for (const page of copy.pages) {
      if (page.background.image) page.background.image.asset = this.aliasFor(page.background.image.asset) ?? page.background.image.asset;
      for (const el of page.elements) if (el.type === "image") el.asset = this.aliasFor(el.asset) ?? el.asset;
    }
    return copy;
  }
}

/** Las rutas de imágenes (fondos y elementos) que usa un documento, sin repetir. */
export function docAssets(doc: DesignDoc): string[] {
  const paths: string[] = [];
  const push = (p: string) => {
    if (!paths.includes(p)) paths.push(p);
  };
  for (const page of doc.pages) {
    if (page.background.image) push(page.background.image.asset);
    for (const el of page.elements) if (el.type === "image") push(el.asset);
  }
  return paths;
}
