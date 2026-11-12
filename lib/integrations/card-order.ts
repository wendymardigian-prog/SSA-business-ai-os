/**
 * En que orden se ven las cards de Integraciones (decision del 12/11/2026).
 *
 * Dos reglas, en este orden de prioridad:
 *  1. Las conectadas arriba y las sin conectar abajo.
 *  2. Dentro de cada grupo, el orden fijo de `BUSINESS_ORDER`; lo que no esta en la lista va despues, en el orden en
 *     que llego.
 *
 * Sitio web y Webhooks no pasan por aca: van siempre al final de Integraciones del negocio, conectadas o no.
 * Puro: lo usan la grilla y los tests.
 */

/** El orden de Integraciones del negocio. `fathom` es la card de la app OAuth, que no esta en el catalogo. */
export const BUSINESS_ORDER: readonly string[] = [
  "resend",
  "resend_inbound",
  "google",
  "meta",
  "meta_capi",
  "fathom",
  "threads",
  "linkedin",
  "postproxy",
  "zernio",
  "evolution",
];

export interface OrderableCard {
  id: string;
  connected: boolean;
}

export function orderCards<T extends OrderableCard>(cards: readonly T[], order: readonly string[] = []): T[] {
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  return cards
    .map((card, arrival) => ({ card, arrival }))
    .sort(
      (a, b) =>
        Number(b.card.connected) - Number(a.card.connected) ||
        rank(a.card.id) - rank(b.card.id) ||
        a.arrival - b.arrival,
    )
    .map(({ card }) => card);
}
