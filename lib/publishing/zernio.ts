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
 *
 * **Zernio programa de su lado** (grupo D). Antes el sistema guardaba la
 * fecha y a esa hora le pedia "publica ahora": eso ataba la publicacion a
 * que nuestro cron corriera en el momento justo. Ahora se le pasa la fecha y
 * la zona, y publica el. `scheduler` es lo que hace esa diferencia; `publish`
 * queda para los casos que sigan pasando por el despachador.
 */

import { createZernioClient } from "@/lib/zernio-client";
import { PublishError } from "@/lib/jobs/errors";
import { classifyZernioError, existingPostIdFrom, zernioStatus } from "./zernio-errors";
import type { ProviderScheduler, Publisher, PublishInput, PublishResult } from "./types";

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
    // Video o fotos, segun el formato elegido (F93). Sin esto TikTok lo
    // deduce de la media; con esto lo que se eligio es lo que sale.
    ...(options.mediaType === "video" || options.mediaType === "photo"
      ? { mediaType: options.mediaType as "video" | "photo" }
      : {}),
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
      // El SDK lo llama `errorMessage`; leer `error` dejaba el motivo del
      // rechazo siempre vacio (A12).
      errorMessage?: string;
      errorCategory?: string;
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
    // Zernio sí distingue: `errorCategory` dice si el problema es del
    // contenido (no se reintenta) o de la plataforma (si).
    const temporal =
      target.errorCategory === "platform_error" || target.errorCategory === "system_error";
    return {
      status: "failed",
      ref,
      error: target.errorMessage || target.error || "Zernio no pudo publicar",
      errorKind: temporal ? "temporary" : "permanent",
    };
  }

  // Todavia sin resultado: el estado final llega por webhook (F35) o
  // preguntando. Tratarlo como fallo publicaria dos veces al reintentar.
  return { status: "processing", ref };
}

/**
 * El cuerpo de `createPost`, compartido por publicar y por programar.
 *
 * Un post de Zernio POR RED: cada red tiene su fecha, su caption y su media,
 * y asi `social_posts` sigue con una fila por red. Un post compartido haria
 * que un fallo de TikTok arrastrara a Instagram.
 */
function createBody(
  input: PublishInput,
  when: { publishNow: true } | { scheduledFor: string; timezone: string },
  requestId?: string,
) {
  if (!input.accountRef) {
    throw new PublishError("Falta la cuenta de Zernio de esa red", "permanent");
  }

  const platformSpecificData =
    input.platform === "instagram"
      ? instagramData(input.options)
      : input.platform === "tiktok"
        ? tiktokData(input.options)
        : undefined;

  return {
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
      ...when,
    },
    // El id de pedido hace que un corte de red despues de que Zernio acepto
    // no cree un segundo post: el reintento recibe el original (A15, D7).
    ...(requestId ? { headers: { "x-request-id": requestId } } : {}),
  };
}

/**
 * Programar, reprogramar, cancelar y reintentar del lado de Zernio (D).
 *
 * Nada de esto pasa por nuestra cola: el post vive agendado en Zernio y el
 * estado vuelve por webhook. Lo unico que guardamos es su id.
 */
export const zernioScheduler: ProviderScheduler = {
  async create(request) {
    const client = createZernioClient(request.credentials.token);

    try {
      const { data, error } = await client.posts.createPost(
        createBody(
          request.input,
          request.now
            ? { publishNow: true }
            : { scheduledFor: request.at, timezone: request.timezone },
          request.requestId,
        ) as never,
      );
      if (error) throw classifyZernioError(error, "Zernio no pudo agendar la publicacion");

      const post = (data as { post?: { _id?: string } } | null)?.post;
      if (!post?._id) {
        throw new PublishError("Zernio no devolvio el id del post agendado", "temporary");
      }
      return { ref: post._id };
    } catch (err) {
      // Si el dedupe de contenido contesta que ya existe, ese post ES el
      // nuestro: tratarlo como fallo dejaria la pieza sin referencia y sin
      // forma de seguirla.
      const existing = existingPostIdFrom(err);
      if (existing) return { ref: existing };
      throw classifyZernioError(err, "Zernio no pudo agendar la publicacion");
    }
  },

  async update(request) {
    const client = createZernioClient(request.credentials.token);

    try {
      const body = createBody(
        request.input,
        request.now
          ? { publishNow: true }
          : { scheduledFor: request.at, timezone: request.timezone },
      ).body;

      const { error } = await client.posts.updatePost({
        path: { postId: request.ref },
        // `isDraft: false` va SIEMPRE junto con la fecha: mandar solo la
        // fecha devuelve 200 y el post sigue siendo borrador.
        body: { ...body, isDraft: false },
      } as never);
      if (error) throw classifyZernioError(error, "Zernio no pudo cambiar la publicacion");
    } catch (err) {
      throw classifyZernioError(err, "Zernio no pudo cambiar la publicacion");
    }
  },

  async cancel({ ref, credentials }) {
    const client = createZernioClient(credentials.token);
    try {
      const { error } = await client.posts.deletePost({ path: { postId: ref } });
      if (error) throw classifyZernioError(error, "Zernio no pudo cancelar la publicacion");
    } catch (err) {
      // Si ya no existe, el objetivo esta cumplido.
      if (zernioStatus(err) === 404) return;
      throw classifyZernioError(err, "Zernio no pudo cancelar la publicacion");
    }
  },

  async retry({ ref, credentials }) {
    const client = createZernioClient(credentials.token);
    try {
      const { error } = await client.posts.retryPost({ path: { postId: ref } });
      if (error) throw classifyZernioError(error, "Zernio no pudo reintentar la publicacion");
    } catch (err) {
      throw classifyZernioError(err, "Zernio no pudo reintentar la publicacion");
    }
  },
};

export const zernioPublisher: Publisher = {
  id: "zernio",
  platforms: ["instagram", "tiktok"],

  async publish({ input, credentials }) {
    const client = createZernioClient(credentials.token);
    let data: unknown;
    let error: unknown;
    try {
      ({ data, error } = await client.posts.createPost(
        createBody(input, { publishNow: true }),
      ));
    } catch (err) {
      throw classifyZernioError(err, "Zernio rechazo la publicacion");
    }

    if (error) throw classifyZernioError(error, "Zernio rechazo la publicacion");

    return readOutcome((data as { post?: unknown })?.post, input.platform);
  },

  async getStatus({ ref, platform, credentials }) {
    const client = createZernioClient(credentials.token);
    let data: unknown;
    let error: unknown;
    try {
      ({ data, error } = await client.posts.getPost({ path: { postId: ref } }));
    } catch (err) {
      // Un 404 es permanente: ese post no existe y preguntar de nuevo va a
      // dar lo mismo. Antes TODO se trataba como temporal y una referencia
      // invalida rebotaba las tres revisiones antes de morir (A12).
      throw classifyZernioError(err, "No pude consultar el estado en Zernio");
    }

    if (error) throw classifyZernioError(error, "No pude consultar el estado en Zernio");

    return readOutcome((data as { post?: unknown })?.post, platform);
  },

  scheduler: zernioScheduler,
  // Un link firmado nuestro vence en 24 horas; un post agendado para la
  // semana que viene lo encontraria muerto. La media se sube a Zernio (D5).
  uploadsMedia: true,
};
