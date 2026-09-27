/**
 * Publicar en Instagram y TikTok por Zernio (F31).
 *
 * Verificado contra el SDK instalado (`@zernio/node` 0.2.x): se crea un post
 * con `posts.createPost`, con la media por URL y las opciones de cada red en
 * `platformSpecificData`. El estado final por red viene en `post.platforms[]`.
 *
 * Zernio acepta varias redes en un solo post, pero aca se publica UNA por vez.
 * No es desperdicio: cada red tiene su propia fila, su propio estado y su
 * propio reintento, y un post compartido haria que un fallo de TikTok
 * arrastrara a Instagram.
 */

import { createZernioClient } from "@/lib/zernio-client";
import { PublishError } from "@/lib/jobs/errors";
import type { Publisher, PublishInput, PublishResult } from "./types";

/** Como se ve un item de media para Zernio. */
function mediaItems(input: PublishInput) {
  return input.mediaUrls.map((url, index) => {
    const entry = input.media[index];
    const kind = entry?.kind ?? "image";
    return {
      type: (kind === "document" ? "document" : kind) as "image" | "video" | "document",
      url,
      altText: entry?.alt_text ?? undefined,
    };
  });
}

/** Las opciones de Instagram, tal como las nombra el SDK. */
export function instagramData(options: Record<string, unknown>) {
  const contentType = options.contentType;
  return {
    // El SDK solo declara 'story': feed y Reel los decide por la media.
    ...(contentType === "story" ? { contentType: "story" as const } : {}),
    ...(typeof options.shareToFeed === "boolean" ? { shareToFeed: options.shareToFeed } : {}),
    ...(Array.isArray(options.collaborators) && options.collaborators.length > 0
      ? { collaborators: options.collaborators as string[] }
      : {}),
    ...(typeof options.coverOffsetMs === "number" ? { thumbOffset: options.coverOffsetMs } : {}),
  };
}

/**
 * Las de TikTok. `mode: draft` va al Creator Inbox.
 *
 * `privacyLevel`, `contentPreviewConfirmed` y `expressConsentGiven` son
 * OBLIGATORIOS para publicar (A8): sin ellos TikTok rechaza el post con un
 * error que no explica nada. La validacion los pide antes de programar, asi
 * que aca ya vienen; se mandan igual con lo que haya para no publicar algo
 * distinto de lo que se eligio.
 */
export function tiktokData(options: Record<string, unknown>) {
  const draft = options.mode === "draft";
  return {
    ...(draft ? { draft: true } : {}),
    ...(typeof options.privacyLevel === "string" ? { privacyLevel: options.privacyLevel } : {}),
    ...(typeof options.allowComment === "boolean" ? { allowComment: options.allowComment } : {}),
    ...(typeof options.allowDuet === "boolean" ? { allowDuet: options.allowDuet } : {}),
    ...(typeof options.allowStitch === "boolean" ? { allowStitch: options.allowStitch } : {}),
    ...(typeof options.commercialContentType === "string"
      ? { commercialContentType: options.commercialContentType }
      : {}),
    ...(typeof options.coverOffsetMs === "number"
      ? { videoCoverTimestampMs: options.coverOffsetMs }
      : {}),
    // Un borrador no se publica: TikTok no pide las confirmaciones.
    ...(draft
      ? {}
      : {
          contentPreviewConfirmed: options.contentPreviewConfirmed === true,
          expressConsentGiven: options.expressConsentGiven === true,
        }),
  };
}

/** El resultado de la red dentro de la respuesta de Zernio. */
function readOutcome(post: unknown, platform: string): PublishResult {
  const typed = post as {
    _id?: string;
    status?: string;
    platforms?: Array<{
      platform?: string;
      status?: string;
      platformPostId?: string;
      platformPostUrl?: string;
      error?: string;
    }>;
  } | null;

  const ref = typed?._id ?? null;
  const target = typed?.platforms?.find((p) => p.platform === platform);

  if (target?.status === "published" && target.platformPostId) {
    return {
      status: "published",
      externalId: target.platformPostId,
      externalUrl: target.platformPostUrl ?? null,
      ref,
    };
  }

  if (target?.status === "failed") {
    return {
      status: "failed",
      ref,
      error: target.error || "Zernio no pudo publicar",
      // Zernio no distingue: se trata como permanente para no reintentar algo
      // que la red ya rechazo. Si fue temporal, se reintenta a mano.
      errorKind: "permanent",
    };
  }

  // Todavia sin resultado: el estado final llega por webhook (F35) o
  // preguntando. Tratarlo como fallo publicaria dos veces al reintentar.
  return { status: "processing", ref };
}

export const zernioPublisher: Publisher = {
  id: "zernio",
  platforms: ["instagram", "tiktok"],

  async publish({ input, credentials }) {
    if (!input.accountRef) {
      throw new PublishError("Falta la cuenta de Zernio de esa red", "permanent");
    }

    const client = createZernioClient(credentials.token);

    const platformSpecificData =
      input.platform === "instagram"
        ? instagramData(input.options)
        : input.platform === "tiktok"
          ? tiktokData(input.options)
          : undefined;

    const { data, error } = await client.posts.createPost({
      body: {
        content: input.text,
        mediaItems: mediaItems(input),
        platforms: [
          {
            platform: input.platform,
            accountId: input.accountRef,
            ...(platformSpecificData ? { platformSpecificData } : {}),
          },
        ],
        // Se publica en el momento: la espera hasta la hora la maneja nuestra
        // cola, no la del proveedor. Un solo lugar donde se cancela o se
        // reprograma (§12).
        publishNow: true,
      },
    });

    if (error) {
      const status = (error as { status?: number }).status;
      throw new PublishError(
        (error as { message?: string }).message ?? "Zernio rechazo la publicacion",
        status === 429 || (status ?? 0) >= 500 ? "temporary" : "permanent",
        status,
      );
    }

    return readOutcome((data as { post?: unknown })?.post, input.platform);
  },

  async getStatus({ ref, platform, credentials }) {
    const client = createZernioClient(credentials.token);
    const { data, error } = await client.posts.getPost({ path: { postId: ref } });

    if (error) {
      throw new PublishError(
        (error as { message?: string }).message ?? "No pude consultar el estado en Zernio",
        "temporary",
      );
    }

    return readOutcome((data as { post?: unknown })?.post, platform);
  },
};
