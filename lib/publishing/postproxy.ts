/**
 * Publicar en YouTube por Postproxy (F32).
 *
 * Postproxy existe para una sola cosa en esta etapa: subir a YouTube sin
 * pasar por la auditoria de Google, que es lo que impide publicar en publico
 * con la API oficial hasta que la aprueben.
 *
 * Su API no documenta webhooks, asi que el estado final se CONSULTA: la
 * publicacion queda "en proceso" y un job vuelve a preguntar (F35). Ver la
 * nota en `lib/social/postproxy.ts` y en docs/PENDIENTE.md.
 */

import { createPost, getPost, platformOutcome, PostproxyError } from "@/lib/social/postproxy";
import { PublishError } from "@/lib/jobs/errors";
import type { Publisher, PublishInput, PublishResult } from "./types";

/**
 * El texto que se manda.
 *
 * Postproxy tiene un solo campo de texto. En YouTube el titulo es
 * obligatorio y la descripcion es aparte, asi que se manda el titulo primero
 * y la descripcion debajo: es lo mas cercano a lo esperado con lo que la API
 * documenta hoy. Al conectar la cuenta real hay que confirmar si acepta el
 * titulo por separado (anotado en PENDIENTE).
 */
function bodyFor(input: PublishInput): string {
  const title = input.title?.trim();
  if (!title) return input.text;
  return input.text.trim() ? `${title}\n\n${input.text}` : title;
}

/**
 * El perfil de Postproxy con el que se publica.
 *
 * Sale del `account_ref` del publicador `postproxy`, que se guarda al probar
 * la clave. Sin el no se publica: mandar cualquier otra cosa hace que
 * Postproxy acepte el pedido y no publique en ningun lado.
 */
function requireProfile(input: PublishInput): string {
  const ref = input.accountRef?.trim();
  if (!ref) {
    throw new PublishError(
      "Falta el perfil de YouTube en Postproxy. Volve a guardar la clave en Ajustes -> Integraciones.",
      "permanent",
    );
  }
  return ref;
}

function toPublishError(error: unknown): PublishError {
  if (error instanceof PostproxyError) {
    return new PublishError(error.message, error.temporary ? "temporary" : "permanent", error.status);
  }
  return new PublishError(
    error instanceof Error ? error.message : String(error),
    "temporary",
  );
}

function toResult(post: { id: string; platforms?: unknown }, platform: string): PublishResult {
  const outcome = platformOutcome(post as never, platform);

  if (outcome.status === "published") {
    // `post.id` es el pedido en Postproxy, no el video: sirve para preguntar
    // el estado (`ref`), no como id externo (A11).
    return {
      status: "published",
      ref: post.id,
      externalId: outcome.externalId,
      externalUrl: outcome.externalUrl,
      ...(outcome.externalId
        ? {}
        : { warning: "Postproxy no informo el id del video: el link queda vacio." }),
    };
  }
  if (outcome.status === "failed") {
    return { status: "failed", ref: post.id, error: outcome.error, errorKind: "permanent" };
  }
  return { status: "processing", ref: post.id };
}

export const postproxyPublisher: Publisher = {
  id: "postproxy",
  platforms: ["youtube"],

  async publish({ input, credentials, fetchImpl }) {
    if (input.mediaUrls.length === 0) {
      throw new PublishError("YouTube necesita un video", "permanent");
    }

    try {
      const post = await createPost({
        apiKey: credentials.token,
        body: bodyFor(input),
        // El perfil DE POSTPROXY. Antes llegaba el id del canal de YouTube
        // (el `external_id` de la cuenta) y Postproxy no lo reconocia (A11).
        profiles: [requireProfile(input)],
        media: input.mediaUrls,
        fetchImpl,
      });

      return toResult(post, "youtube");
    } catch (error) {
      throw toPublishError(error);
    }
  },

  async getStatus({ ref, credentials, fetchImpl }) {
    try {
      const post = await getPost(credentials.token, ref, fetchImpl);
      return toResult(post, "youtube");
    } catch (error) {
      throw toPublishError(error);
    }
  },
};
