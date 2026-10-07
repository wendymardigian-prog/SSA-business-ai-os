/**
 * El estado de cada red de una pieza (Contenido v4, C3 y C8).
 *
 * Cinco estados y ninguno se elige a dedo: cuatro se derivan y uno
 * (publicado a mano) se marca con un boton, que crea una fila real.
 *
 *   Sin fecha        la red no tiene fecha
 *   Fecha tentativa  tiene fecha y nada agendado: "esto lo subo yo"
 *   Programado       hay una fila viva en la cola: "esto sale solo"
 *   Publicado        la red lo confirmo, o alguien lo marco a mano
 *   Fallo            la publicacion fallo (F35)
 *
 * **Programado sale de la fila de `social_posts`, no de `auto`.** `auto` es lo
 * que la persona pidio; la fila es lo que de verdad va a pasar. Si las dos
 * no coinciden, la pantalla tiene que decir la verdad de la cola. Y una red
 * sin cuenta conectada nunca esta "Programada": no hay nada que la publique.
 *
 * Distinguir Programado de Fecha tentativa de un vistazo es lo mas importante
 * de todo el modulo: confundirlos es creer que algo sale solo cuando no.
 *
 * Puro: lo usan el drawer, el kanban, el calendario y Social.
 */

import type { SocialPostStatus } from "@/lib/types/database";

export type NetworkStateId = "none" | "tent" | "sched" | "pub" | "fail";

export interface NetworkPublication {
  platform: string;
  status: SocialPostStatus | null;
  scheduledAt: string | null;
  publishedAt?: string | null;
  origin?: string | null;
}

export interface NetworkStateView {
  id: NetworkStateId;
  /** "Programado", "Publicado a mano"… */
  label: string;
  /** Publicado porque alguien lo marco a mano. */
  manual: boolean;
  /** La fecha que corresponde mostrar: la de salida, la programada o la tentativa. */
  at: string | null;
}

/** Lo que cuenta como "en la cola": va a salir solo. */
const QUEUED: SocialPostStatus[] = ["scheduled", "uploading", "publishing"];

export const NETWORK_STATE_TEXT: Record<NetworkStateId, string> = {
  none: "Sin fecha",
  tent: "Fecha tentativa",
  sched: "Programado",
  pub: "Publicado",
  fail: "Falló",
};

export function networkStateOf(params: {
  plannedAt: string | null | undefined;
  publication: NetworkPublication | undefined;
  connected: boolean;
}): NetworkStateView {
  const { publication } = params;
  const plannedAt = params.plannedAt ?? null;

  if (publication?.status === "published") {
    const manual = publication.origin === "manual";
    return {
      id: "pub",
      label: manual ? "Publicado a mano" : "Publicado",
      manual,
      at: publication.publishedAt ?? publication.scheduledAt ?? plannedAt,
    };
  }

  if (publication?.status === "failed") {
    return { id: "fail", label: NETWORK_STATE_TEXT.fail, manual: false, at: publication.scheduledAt ?? plannedAt };
  }

  if (publication?.status && QUEUED.includes(publication.status) && params.connected) {
    return {
      id: "sched",
      label: publication.status === "publishing" ? "Publicando" : NETWORK_STATE_TEXT.sched,
      manual: false,
      at: publication.scheduledAt ?? plannedAt,
    };
  }

  // 'cancelled', sin fila, o una fila en cola de una red que ya no esta
  // conectada: vale la fecha de la pieza.
  if (!plannedAt) return { id: "none", label: NETWORK_STATE_TEXT.none, manual: false, at: null };
  return { id: "tent", label: NETWORK_STATE_TEXT.tent, manual: false, at: plannedAt };
}

/** Lo que pidio la persona: si falta, se deduce de la cola (piezas de antes de v4). */
export function effectiveAuto(
  network: { auto?: boolean | null },
  publication: NetworkPublication | undefined,
): boolean {
  if (typeof network.auto === "boolean") return network.auto;
  return Boolean(publication?.status && QUEUED.includes(publication.status));
}

export interface NetworkCounts {
  scheduled: number;
  tentative: number;
  published: number;
}

export function countNetworkStates(states: Array<{ id: NetworkStateId }>): NetworkCounts {
  return {
    scheduled: states.filter((s) => s.id === "sched").length,
    tentative: states.filter((s) => s.id === "tent").length,
    published: states.filter((s) => s.id === "pub").length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "1 programada · 2 tentativas · 0 publicadas", para el pie del drawer. */
export function networkSummaryText(states: Array<{ id: NetworkStateId }>): string {
  if (states.length === 0) return "Todavía no elegiste ninguna red";
  const c = countNetworkStates(states);
  return [
    plural(c.scheduled, "programada", "programadas"),
    plural(c.tentative, "tentativa", "tentativas"),
    plural(c.published, "publicada", "publicadas"),
  ].join(" · ");
}
