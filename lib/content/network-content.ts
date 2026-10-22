/**
 * Lo que sale publicado en cada red, resuelto desde la pieza.
 *
 * Es el mismo calculo que hacen el editor, la validacion al programar
 * (`schedule-core`) y el despachador (`buildInput`): el caption y los archivos
 * propios de la red o los base, su titulo, su formato y sus opciones. Vive
 * aparte, sin base ni React, para que el guardado pueda comparar el "antes" y
 * el "despues" de una red y saber si hay que reenviarsela al proveedor.
 */

import type { MediaEntry } from "./media";
import { resolveNetworkOptions } from "./network-format";
import { resolveNetworkContent, type NetworkEntry } from "./redistribution";
import type { NetworkContent } from "./validation";

export function networkContentOf(params: {
  network: NetworkEntry;
  baseCaption: string | null;
  baseMedia: MediaEntry[];
}): NetworkContent {
  const resolved = resolveNetworkContent<MediaEntry>(params);
  return {
    platform: String(params.network.platform ?? ""),
    text: resolved.caption,
    media: resolved.media,
    title: params.network.youtube_title ?? null,
    format: params.network.format ?? null,
    options: resolveNetworkOptions(params.network),
  };
}

/** Todas las redes de una pieza, por plataforma. */
export function networkContents(params: {
  networks: NetworkEntry[];
  baseCaption: string | null;
  baseMedia: MediaEntry[];
}): Record<string, NetworkContent> {
  return Object.fromEntries(
    params.networks.map((network) => {
      const content = networkContentOf({ network, baseCaption: params.baseCaption, baseMedia: params.baseMedia });
      return [content.platform, content];
    }),
  );
}

/**
 * Una huella de lo que se publica: texto, archivos (en orden, sin los
 * borrados), titulo, formato y opciones. Dos huellas iguales = el proveedor ya
 * tiene la version vigente; mover una fecha no cambia la huella.
 */
export function contentFingerprint(content: NetworkContent): string {
  return JSON.stringify({
    text: content.text,
    media: content.media.filter((m) => !m.deleted_at).map((m) => m.storage_path),
    title: content.title ?? null,
    format: content.format ?? null,
    options: sortKeys(content.options ?? {}),
  });
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * Que redes agendadas del lado del proveedor cambiaron de contenido con este
 * guardado: a esas hay que reenviarles la version nueva, o el proveedor
 * publica la vieja.
 */
export function providerResyncTargets(params: {
  before: Record<string, NetworkContent>;
  after: Record<string, NetworkContent>;
  publications: Array<{
    id: string;
    platform: string;
    status: string | null;
    onProvider: boolean;
  }>;
}): Array<{ id: string; platform: string; content: NetworkContent }> {
  const targets: Array<{ id: string; platform: string; content: NetworkContent }> = [];
  for (const p of params.publications) {
    if (!p.onProvider || p.status !== "scheduled") continue;
    const after = params.after[p.platform];
    const before = params.before[p.platform];
    // Una red que se saco de la pieza no se reenvia: eso es desprogramar, no editar.
    if (!after || !before) continue;
    if (contentFingerprint(after) === contentFingerprint(before)) continue;
    targets.push({ id: p.id, platform: p.platform, content: after });
  }
  return targets;
}
