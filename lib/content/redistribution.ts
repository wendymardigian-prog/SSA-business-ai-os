/**
 * Variantes, duplicar y redistribuir (F28).
 *
 * Tres cosas que suenan parecido y no lo son:
 *
 *  - **Variante dentro de la pieza**: una red usa su propio caption, su
 *    propia media o su propio CTA. Sigue siendo UNA pieza, con un copy y un
 *    estado. El carrusel de LinkedIn es otro, pero el video es el mismo.
 *  - **Duplicar como variante**: se crea OTRA pieza con lo mismo copiado, con
 *    la misma idea de origen. Son dos piezas distintas que se cuentan por
 *    separado.
 *  - **Redistribuir**: a una pieza ya publicada se le agrega una red con otra
 *    fecha. Sigue siendo la misma pieza; en el calendario es otra tarjeta con
 *    ↻ y en el tablero no se mueve de columna.
 *
 * Confundirlas cambia los numeros del mes, que es lo que se mira para saber
 * si se esta produciendo lo suficiente.
 */

import type { ContentPostStatus } from "@/lib/types/database";
import type { CtaType } from "./keywords";

export interface NetworkEntry {
  platform: string;
  planned_at?: string | null;
  /** null = usa el caption base. */
  caption?: string | null;
  /** null = usa la media base. */
  media?: unknown[] | null;
  cta?: { type: CtaType; keyword?: string | null } | null;
  options?: Record<string, unknown>;
  publisher?: string | null;
  youtube_title?: string | null;
}

/** Si esa red tiene algo propio, o usa todo lo de la pieza. */
export function hasVariant(network: NetworkEntry): boolean {
  return Boolean(
    (network.caption !== null && network.caption !== undefined) ||
      (network.media !== null && network.media !== undefined),
  );
}

/** Que usa esa red, ya resuelto contra lo base. */
export function resolveNetworkContent<T>(params: {
  network: NetworkEntry;
  baseCaption: string | null;
  baseMedia: T[];
}): { caption: string; media: T[]; ownCaption: boolean; ownMedia: boolean } {
  const ownCaption = params.network.caption !== null && params.network.caption !== undefined;
  const ownMedia = params.network.media !== null && params.network.media !== undefined;

  return {
    caption: (ownCaption ? params.network.caption : params.baseCaption) ?? "",
    media: (ownMedia ? (params.network.media as T[]) : params.baseMedia) ?? [],
    ownCaption,
    ownMedia,
  };
}

export interface DuplicateSource {
  id: string;
  idea_id: string | null;
  title: string;
  format: string | null;
  copy: Record<string, unknown>;
  caption: string | null;
  networks: NetworkEntry[];
  media: unknown[];
}

/**
 * La pieza nueva al "duplicar como variante".
 *
 * Conserva la idea de origen (las dos salieron de la misma) y copia todo,
 * PERO limpia las fechas: heredarlas programaria dos piezas para el mismo
 * momento sin que nadie lo haya pedido. Nace en borrador.
 */
export function duplicateAsVariant(source: DuplicateSource): {
  idea_id: string | null;
  title: string;
  format: string | null;
  copy: Record<string, unknown>;
  caption: string | null;
  networks: NetworkEntry[];
  media: unknown[];
  status: ContentPostStatus;
} {
  return {
    idea_id: source.idea_id,
    title: `${source.title} (variante)`,
    format: source.format,
    copy: { ...source.copy },
    caption: source.caption,
    networks: source.networks.map((n) => ({ ...n, planned_at: null })),
    media: [...source.media],
    status: "draft",
  };
}

export interface RedistributeContext {
  postStatus: ContentPostStatus;
  /** Las redes que ya tienen publicacion. */
  publishedPlatforms: string[];
  connected: string[];
  /** Si el copy o la media base cambiaron desde que se aprobo. */
  baseChangedSinceApproval: boolean;
}

export type RedistributeDecision =
  | { ok: true; needsReview: false }
  /** Se puede, pero esa red vuelve a revision. */
  | { ok: true; needsReview: true; reason: string }
  | { ok: false; error: string };

/**
 * Agregar una red a una pieza ya publicada.
 *
 * No hace falta volver a aprobar: lo que se aprobo es el contenido, y es el
 * mismo. Salvo que el copy o la media base hayan cambiado despues, porque
 * entonces lo que saldria no es lo que se aprobo.
 */
export function canRedistribute(
  platform: string,
  context: RedistributeContext,
): RedistributeDecision {
  const publicado = ["published", "partially_published", "publishing", "scheduled"];
  if (!publicado.includes(context.postStatus)) {
    return {
      ok: false,
      error: "Redistribuir es para una pieza que ya salio. Esta todavia no se programo.",
    };
  }

  if (context.publishedPlatforms.includes(platform)) {
    return { ok: false, error: `Esa pieza ya tiene una publicacion en ${platform}.` };
  }

  if (!context.connected.includes(platform)) {
    return { ok: false, error: `No hay una cuenta de ${platform} conectada.` };
  }

  if (context.baseChangedSinceApproval) {
    return {
      ok: true,
      needsReview: true,
      reason: "El copy o la media cambiaron despues de aprobar: esta red vuelve a revision.",
    };
  }

  return { ok: true, needsReview: false };
}

/**
 * Si una salida es redistribucion: cualquier fecha posterior a la primera de
 * la pieza.
 */
export function isRedistribution(at: string, allDates: string[]): boolean {
  const earliest = [...allDates].filter(Boolean).sort()[0];
  return Boolean(earliest) && at > earliest;
}
