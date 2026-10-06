/**
 * La biblioteca de archivos de una pieza (F92).
 *
 * `content_posts.media` pasa a ser la BIBLIOTECA: todos los archivos de la
 * pieza, subidos una sola vez. Cada red elige los suyos en `networks[].files`,
 * como lista ordenada de ids; no guarda copias del archivo. Asi se ve de un
 * vistazo que archivos no usa ninguna red y se puede reordenar sin volver a
 * subir nada.
 *
 * Todo puro: no toca la base ni el bucket (eso es de `lib/actions/content-media.ts`).
 */

import { liveMedia, type MediaEntry } from "./media";
import type { NetworkEntry } from "./redistribution";

/**
 * El id de un archivo: el nombre que se genero al subirlo (un uuid) sin la
 * extension. Los archivos subidos antes de F92 no guardaron `id`, y asi lo
 * reciben "al leerse" sin migrar nada: el path es unico y no cambia, y es
 * justamente lo que hace estable la referencia de `networks[].files`.
 */
export function mediaIdFor(storagePath: string): string {
  const name = storagePath.split("/").pop() ?? storagePath;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function idOf(entry: MediaEntry): string {
  return entry.id ?? mediaIdFor(entry.storage_path);
}

/** Les da `id` a los archivos que no lo tienen. No muta lo que recibe. */
export function ensureMediaIds(media: MediaEntry[]): Array<MediaEntry & { id: string }> {
  return media.map((m) => ({ ...m, id: idOf(m) }));
}

/**
 * Los ids de archivo que usa una red.
 *
 * - Modelo nuevo (`files`): esos, en ese orden, ignorando los que ya no estan
 *   en la biblioteca.
 * - Modelo anterior: con media propia, esa; sin ella, TODA la base (asi
 *   funcionaba: "igual a la base").
 */
export function networkFileIds(network: NetworkEntry, library: MediaEntry[]): string[] {
  const live = liveMedia(library);
  const known = new Set(live.map(idOf));

  if (Array.isArray(network.files)) return network.files.filter((id) => known.has(id));

  if (Array.isArray(network.media)) {
    const paths = new Set((network.media as MediaEntry[]).map((m) => m.storage_path));
    return live.filter((m) => paths.has(m.storage_path)).map(idOf);
  }

  return live.map(idOf);
}

/** Que redes usan cada archivo (id -> plataformas, en el orden de las redes). */
export function usageByFile(library: MediaEntry[], networks: NetworkEntry[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const entry of liveMedia(library)) usage.set(idOf(entry), []);

  for (const network of networks) {
    for (const id of networkFileIds(network, library)) {
      const list = usage.get(id);
      if (list && !list.includes(network.platform)) list.push(network.platform);
    }
  }

  return usage;
}

/** Los archivos que ninguna red usa ("sin usar", en naranja). */
export function unusedFiles(library: MediaEntry[], networks: NetworkEntry[]): MediaEntry[] {
  const usage = usageByFile(library, networks);
  return liveMedia(library).filter((m) => (usage.get(idOf(m)) ?? []).length === 0);
}

/**
 * Saca un archivo de las redes que lo usan (F92).
 *
 * Es lo que pasa al quitarlo de la biblioteca: ninguna red puede quedar
 * apuntando a algo que ya no existe. Devuelve las redes afectadas para
 * avisarlo. Solo toca `files`: una red del modelo anterior no tiene ids a los
 * que apuntar.
 */
export function removeFileFromNetworks(
  networks: NetworkEntry[],
  fileId: string,
): { networks: NetworkEntry[]; affected: string[] } {
  const affected: string[] = [];

  const out = networks.map((network) => {
    if (!Array.isArray(network.files) || !network.files.includes(fileId)) return network;
    affected.push(network.platform);
    return { ...network, files: network.files.filter((id) => id !== fileId) };
  });

  return { networks: out, affected };
}

// ── Como se muestra ────────────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  image: "Imagen",
  video: "Video",
  document: "Documento",
};

/** Las proporciones que se reconocen a simple vista. */
const KNOWN_RATIOS: Array<[string, number]> = [
  ["1:1", 1],
  ["4:5", 4 / 5],
  ["9:16", 9 / 16],
  ["16:9", 16 / 9],
  ["3:4", 3 / 4],
  ["4:3", 4 / 3],
  ["2:3", 2 / 3],
  ["3:2", 3 / 2],
];

/**
 * "9:16", "16:9"... Una proporcion conocida con un 1% de margen; si no
 * encaja, el decimal ("1.91:1"), que es como se nombra la de LinkedIn.
 */
export function aspectRatioLabel(
  width: number | null | undefined,
  height: number | null | undefined,
): string | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const ratio = width / height;
  const known = KNOWN_RATIOS.find(([, value]) => Math.abs(ratio - value) / value < 0.01);
  if (known) return known[0];
  return `${ratio >= 1 ? ratio.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") : ratio.toFixed(2)}:1`;
}

/** El nombre original si se guardo; si no, "Video 2" (tipo y lugar en la lista). */
export function displayName(entry: MediaEntry, index: number): string {
  const name = entry.name?.trim();
  if (name) return name;
  return `${KIND_LABELS[entry.kind] ?? "Archivo"} ${index + 1}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describeFile(
  entry: MediaEntry,
  index: number,
): { name: string; kindLabel: string; size: string; ratio: string | null } {
  return {
    name: displayName(entry, index),
    kindLabel: KIND_LABELS[entry.kind] ?? "Archivo",
    size: formatSize(entry.size_bytes),
    ratio: aspectRatioLabel(entry.width, entry.height),
  };
}
