/**
 * Busqueda del picker "/" de la banca de recursos (texto + audio).
 *
 * No reimplementa nada: reutiliza filterTemplates (lib/templates/search.ts),
 * que ya sabe buscar por nombre, atajo, etiquetas y contenido. Lo unico que
 * se adapta aca es el campo de texto: un texto trae `content`, un audio trae
 * `transcript`, y nunca los dos (lo garantiza el CHECK de la tabla). El
 * mapeo le da a ese campo un significado honesto en vez de forzar el nombre
 * `content` sobre una transcripcion.
 */

import { filterTemplates, type SearchableTemplate } from "@/lib/templates/search";
import type { AssetKind } from "./kind";

export interface SearchableAsset {
  id: string;
  kind: AssetKind;
  name: string;
  shortcut: string | null;
  content: string | null;
  transcript: string | null;
  tags?: string[] | null;
}

/**
 * Filtra recursos (de los dos tipos a la vez) por nombre, atajo, etiquetas o
 * su texto: el contenido de un texto, la transcripcion de un audio. Un audio
 * sin transcripcion lista (todavia transcribiendo, o fallo) sigue siendo
 * buscable por nombre, atajo y etiquetas igual; el campo vacio no excluye
 * nada, solo no suma ese criterio.
 */
export function filterAssets<T extends SearchableAsset>(assets: T[], query: string): T[] {
  const asTemplates: (T & SearchableTemplate)[] = assets.map((asset) => ({
    ...asset,
    content: asset.kind === "audio" ? (asset.transcript ?? "") : (asset.content ?? ""),
  }));
  return filterTemplates(asTemplates, query);
}
