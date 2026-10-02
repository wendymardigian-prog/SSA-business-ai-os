/**
 * Que publicador de `social_accounts.publishers` corresponde a cada card de
 * Integraciones (G7).
 *
 * La pestaña Cuentas de zernio, postproxy, google, linkedin y threads
 * muestra las cuentas sociales que tienen ESE publicador entre sus entradas,
 * sin importar la plataforma: zernio aparece en instagram y en tiktok,
 * mientras que google y postproxy solo aparecen en youtube (los dos publican
 * ahi, por caminos distintos).
 */

import type { PublisherId } from "@/lib/social/accounts-schema";

const PUBLISHER_BY_PROVIDER: Partial<Record<string, PublisherId>> = {
  zernio: "zernio",
  postproxy: "postproxy",
  google: "youtube_api",
  linkedin: "linkedin_api",
  threads: "threads_api",
};

/** `null` si la integracion no es una de publicacion (no tiene cuentas que elegir). */
export function publisherIdFor(providerId: string): PublisherId | null {
  return PUBLISHER_BY_PROVIDER[providerId] ?? null;
}
