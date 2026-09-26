/**
 * Publicar en LinkedIn (F34).
 *
 * Posts API (`/rest/posts`), con el header de version en cada llamada. El
 * autor es el URN de la persona, que se guardo al conectar.
 *
 * Esta etapa publica TEXTO. Imagenes, video y PDF necesitan registrar el
 * archivo y subirlo por partes antes de crear el post, y eso es varias veces
 * mas codigo: se implementa cuando haya una cuenta real con la que probarlo
 * (anotado en PENDIENTE). Un post con media se rechaza con un mensaje claro
 * en vez de publicar solo el texto sin avisar.
 */

import { linkedinHeaders, LINKEDIN_API_VERSION } from "@/lib/social/linkedin";
import { PublishError } from "@/lib/jobs/errors";
import type { Publisher } from "./types";

const POSTS_URL = "https://api.linkedin.com/rest/posts";

export const linkedinPublisher: Publisher = {
  id: "linkedin_api",
  platforms: ["linkedin"],

  async publish({ input, credentials, fetchImpl }) {
    if (!input.accountRef) {
      throw new PublishError("Falta el perfil de LinkedIn al que publicar", "permanent");
    }

    if (input.mediaUrls.length > 0) {
      throw new PublishError(
        "Por ahora LinkedIn solo publica texto desde el sistema. Subi la imagen o el video a mano.",
        "permanent",
      );
    }

    const response = await (fetchImpl ?? fetch)(POSTS_URL, {
      method: "POST",
      headers: { ...linkedinHeaders(credentials.token), "Content-Type": "application/json" },
      body: JSON.stringify({
        author: input.accountRef,
        commentary: input.text,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new PublishError(
        detail || `LinkedIn respondio ${response.status}`,
        response.status === 429 || response.status >= 500 ? "temporary" : "permanent",
        response.status,
      );
    }

    // El id del post viene en la cabecera, no en el cuerpo.
    const urn = response.headers.get("x-restli-id") ?? response.headers.get("x-linkedin-id");

    return {
      status: "published",
      externalId: urn,
      externalUrl: urn ? `https://www.linkedin.com/feed/update/${urn}` : null,
      ref: urn,
    };
  },
};

export { LINKEDIN_API_VERSION };
