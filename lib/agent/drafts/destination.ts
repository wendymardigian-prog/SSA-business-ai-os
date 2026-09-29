/**
 * A donde lleva un acceso a la cola de borradores, y que dice la cola cuando
 * el filtro por defecto no tiene nada.
 *
 * El problema que resuelve: el contador que ve un Owner/Admin es el TOTAL del
 * workspace, pero la cola abre en "mios" (`QUIEN_MINE`). Una Owner sin
 * contactos propios veia "Borradores (1)" y entraba a una pantalla que decia
 * "No hay borradores esperando". El numero era cierto y la pantalla tambien:
 * lo que estaba mal era el destino.
 *
 * Puro y sin dependencias: lo importan el menu lateral, la barra del telefono
 * y la bandeja, que son del navegador.
 */

import { QUIEN_ALL } from "./queue-query";

/** Lo que devuelve `countPendingDrafts`: `total` y `unassigned` solo para Owner/Admin. */
export interface DraftCountsLike {
  mine: number;
  unassigned: number | null;
  total: number | null;
}

export const DRAFTS_PATH = "/dashboard/drafts";

/**
 * El link de cualquier acceso a la cola.
 *
 * Si la persona no tiene borradores propios pero hay otros (solo lo sabe
 * Owner/Admin, que es quien recibe `total`), abre directo en "todos": el
 * numero del acceso y lo que se ve al entrar tienen que ser lo mismo.
 */
export function draftsQueueHref(counts: DraftCountsLike | undefined): string {
  if (!counts) return DRAFTS_PATH;
  const total = counts.total;
  if (counts.mine === 0 && total !== null && total > 0) return `${DRAFTS_PATH}?quien=${QUIEN_ALL}`;
  return DRAFTS_PATH;
}

/** Cuantos borradores hay que no son de quien mira (0 si no se sabe). */
export function otherPeopleDrafts(counts: DraftCountsLike | undefined): number {
  if (!counts || counts.total === null) return 0;
  return Math.max(0, counts.total - counts.mine);
}

/**
 * El estado vacio de la cola filtrada en "mios": si hay borradores de otras
 * personas, lo dice con la cantidad y ofrece verlos.
 */
export function emptyQueueHint(counts: DraftCountsLike | undefined): { text: string; action: { label: string; quien: string } | null } {
  const others = otherPeopleDrafts(counts);
  if (others === 0) {
    return {
      text: "Cuando el agente deje una respuesta para aprobar en una conversación tuya, aparece acá sola.",
      action: null,
    };
  }
  return {
    text:
      others === 1
        ? "No hay ninguno tuyo esperando. Hay 1 de otra persona del equipo."
        : `No hay ninguno tuyo esperando. Hay ${others} de otras personas del equipo.`,
    action: { label: others === 1 ? "Ver todos (1)" : `Ver todos (${others})`, quien: QUIEN_ALL },
  };
}
