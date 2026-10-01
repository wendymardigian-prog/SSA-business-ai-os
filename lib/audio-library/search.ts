/**
 * Busqueda del picker "/a" de la banca de audios (F21).
 *
 * No reimplementa nada: reutiliza filterTemplates (lib/templates/search.ts),
 * que ya sabe buscar por nombre y atajo, y desde la extension de esta misma
 * corrida tambien busca por "content" como ultimo criterio. Ahi va la
 * transcripcion de cada audio.
 */

import { filterTemplates, type SearchableTemplate } from "@/lib/templates/search";

export interface SearchableAudioAsset {
  id: string;
  name: string;
  shortcut: string | null;
  transcript: string | null;
}

/**
 * Filtra audios por nombre, atajo o transcripcion. Un audio sin transcripcion
 * lista (todavia transcribiendo, o fallo) sigue siendo buscable por nombre y
 * atajo igual; el campo vacio no excluye nada, solo no suma ese criterio.
 */
export function filterAudioAssets<T extends SearchableAudioAsset>(assets: T[], query: string): T[] {
  const asTemplates: (T & SearchableTemplate)[] = assets.map((asset) => ({
    ...asset,
    content: asset.transcript ?? "",
  }));
  return filterTemplates(asTemplates, query);
}
