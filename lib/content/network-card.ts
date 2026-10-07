/**
 * Que muestra y que ofrece la tarjeta de una red en el drawer (Contenido v4).
 *
 * Todo lo que se decide sin dibujar: si lleva el chip "a mano", como se
 * publica, por que una opcion esta deshabilitada, si se puede marcar como
 * publicada y si hay linea de publicador. El componente solo lo pinta.
 *
 * Las mismas reglas valen en el servidor (`setNetworkPublishMode`,
 * `markNetworkPublished`): la pantalla deshabilita, el servidor rechaza.
 */

import type { ContentPostStatus } from "@/lib/types/database";
import type { NetworkStateView } from "./network-state";

/** Desde aca una pieza se puede programar: ya paso por la aprobacion. */
export const SCHEDULABLE_STATUSES: ContentPostStatus[] = [
  "approved",
  "scheduled",
  "publishing",
  "published",
  "partially_published",
  "failed",
];

export type PublishMode = "self" | "system";

export interface NetworkCardView {
  /** Chip "a mano" en la cabecera: la red no tiene cuenta conectada. */
  manualChip: boolean;
  /** Que opcion esta marcada en "Como se publica". */
  mode: PublishMode;
  /** Si "El sistema la publica" no se puede elegir, por que. */
  systemDisabledReason: string | null;
  /** Si "La subo yo" no se puede elegir (cambiar el modo), por que. */
  selfDisabledReason: string | null;
  canMarkPublished: boolean;
  canUndoManual: boolean;
}

export function systemModeBlock(params: {
  connected: boolean;
  canPublish: boolean;
  postStatus: ContentPostStatus;
  state: NetworkStateView;
}): string | null {
  // El orden importa: primero lo que no depende de la persona.
  if (!params.connected) return "Conectá la cuenta en Integraciones para programar.";
  if (!params.canPublish) return "Programar es de quien puede publicar.";
  if (params.state.id === "pub") return "Ya está publicada.";
  if (!SCHEDULABLE_STATUSES.includes(params.postStatus)) {
    return "Se programa cuando la pieza esté aprobada.";
  }
  return null;
}

export function networkCardView(params: {
  connected: boolean;
  canPublish: boolean;
  postStatus: ContentPostStatus;
  state: NetworkStateView;
  /** Lo que pidio la persona (`effectiveAuto`). */
  auto: boolean;
}): NetworkCardView {
  const { connected, canPublish, state } = params;

  // Una red sin cuenta nunca esta en "el sistema la publica", aunque el dato
  // diga otra cosa: no hay nada que la publique.
  const mode: PublishMode = params.auto && connected ? "system" : "self";

  const systemDisabledReason = systemModeBlock(params);

  let selfDisabledReason: string | null = null;
  if (!canPublish) selfDisabledReason = "Cambiar cómo se publica es de quien puede publicar.";
  else if (state.id === "pub") selfDisabledReason = "Ya está publicada.";
  else if (state.label === "Publicando") selfDisabledReason = "Se está publicando en este momento.";

  return {
    manualChip: !connected,
    mode,
    systemDisabledReason,
    selfDisabledReason,
    canMarkPublished: canPublish && state.id !== "pub",
    canUndoManual: canPublish && state.id === "pub" && state.manual,
  };
}

/**
 * La linea "Se publica con X · cambiar en Integraciones" (C10).
 *
 * Solo cuando la red tiene MAS de un camino: con uno solo no hay nada que
 * decidir y la linea es ruido. Hoy la unica red con dos es YouTube (Postproxy
 * o la API de Google).
 */
export function publisherLine(params: {
  available: string[];
  current: string | null;
  labels: Record<string, string>;
}): string | null {
  if (params.available.length <= 1 || !params.current) return null;
  return params.labels[params.current] ?? params.current;
}
