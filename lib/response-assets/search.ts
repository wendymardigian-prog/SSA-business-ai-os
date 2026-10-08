/**
 * Busqueda de la banca de recursos (los seis tipos a la vez): el widget del
 * chat y la pantalla de gestion.
 *
 * No reimplementa nada: reutiliza filterTemplates (lib/templates/search.ts),
 * que ya sabe buscar por nombre, atajo, etiquetas y contenido sin acentos y
 * con ranking. Lo unico que se adapta aca es el campo de texto, que cambia
 * segun el tipo:
 *
 *   texto           -> el contenido
 *   audio, video    -> la transcripcion
 *   enlace          -> la URL
 *   imagen, archivo -> (nada propio)
 *
 * y a eso se le suma la descripcion en todos los tipos: en una imagen o un
 * PDF es lo unico que dice que es. Un recurso sin nada de eso sigue siendo
 * buscable por nombre, atajo y etiquetas: el campo vacio no excluye, solo no
 * suma ese criterio.
 *
 * El orden: primero la relevancia (la de filterTemplates); entre dos igual de
 * relevantes, el mas usado; y sin busqueda, los mas usados primero y despues
 * los mas nuevos.
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
  description?: string | null;
  url?: string | null;
  usageCount?: number | null;
  lastUsedAt?: string | null;
  createdAt?: string | null;
}

/** El texto propio de cada tipo (sin la descripcion). */
export function primaryText(asset: Pick<SearchableAsset, "kind" | "content" | "transcript" | "url">): string {
  switch (asset.kind) {
    case "text":
      return asset.content ?? "";
    case "audio":
    case "video":
      return asset.transcript ?? "";
    case "link":
      return asset.url ?? "";
    case "image":
    case "file":
      return "";
  }
}

function searchText(asset: SearchableAsset): string {
  return [primaryText(asset), asset.description ?? ""].filter(Boolean).join("\n");
}

const time = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() : 0);

/** Mas usado primero; empate, el usado mas recientemente; despues el mas nuevo; despues el nombre. */
export function compareByUsage(a: SearchableAsset, b: SearchableAsset): number {
  return (
    (b.usageCount ?? 0) - (a.usageCount ?? 0) ||
    time(b.lastUsedAt) - time(a.lastUsedAt) ||
    time(b.createdAt) - time(a.createdAt) ||
    a.name.localeCompare(b.name, "es")
  );
}

/** Filtra y ordena (ver la cabecera). */
export function filterAssets<T extends SearchableAsset>(assets: T[], query: string): T[] {
  const sorted = [...assets].sort(compareByUsage);
  const asTemplates: (T & SearchableTemplate)[] = sorted.map((asset) => ({
    ...asset,
    content: searchText(asset),
  }));
  const matches = filterTemplates(asTemplates, query, compareByUsage);
  // Se devuelven los objetos originales, no los adaptados: si no, `content`
  // de un audio volveria con su transcripcion adentro.
  const byId = new Map(assets.map((a) => [a.id, a] as const));
  return matches.map((m) => byId.get(m.id) as T);
}
