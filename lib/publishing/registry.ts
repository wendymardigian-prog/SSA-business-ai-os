/**
 * Que publicador usa cada red (F30).
 *
 * Una red puede tener mas de uno (YouTube: Postproxy o la API oficial), y
 * cual se usa lo decide la cuenta social (`default_publisher`). Aca solo se
 * resuelve el id a su implementacion.
 */

import type { PublisherId } from "@/lib/social/accounts-schema";
import type { Publisher } from "./types";

const publishers = new Map<string, Publisher>();

export function registerPublisher(publisher: Publisher): void {
  publishers.set(publisher.id, publisher);
}

/** Error de un publicador que no existe. Termina la publicacion en fallida. */
export class UnknownPublisherError extends Error {
  constructor(readonly publisherId: string) {
    super(`No se como publicar con "${publisherId}"`);
    this.name = "UnknownPublisherError";
  }
}

/**
 * El publicador de un id.
 *
 * Lanza si no existe, en vez de devolver undefined: el dispatcher lo
 * convierte en un fallo permanente, que es lo que corresponde. Seguir con un
 * publicador nulo dejaria la fila en "publicando" para siempre.
 */
export function getPublisher(publisherId: string): Publisher {
  const publisher = publishers.get(publisherId);
  if (!publisher) throw new UnknownPublisherError(publisherId);
  return publisher;
}

export function hasPublisher(publisherId: string): boolean {
  return publishers.has(publisherId);
}

/** Los publicadores que saben publicar en esa red. */
export function publishersFor(platform: string): Publisher[] {
  return [...publishers.values()].filter((p) => p.platforms.includes(platform));
}

export function registeredPublishers(): PublisherId[] {
  return [...publishers.keys()].sort() as PublisherId[];
}

/** Para los tests. */
export function resetPublishers(): void {
  publishers.clear();
}
