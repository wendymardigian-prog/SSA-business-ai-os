/**
 * Publicar en Threads (F34).
 *
 * Dos pasos, como toda la familia de Meta: se crea un contenedor y despues se
 * publica. Un hilo son varios posts encadenados, cada uno respondiendo al
 * anterior.
 *
 * Portado de ScaleOS (`_shared/threads.ts`), adaptado a la interfaz comun.
 */

import { THREADS_HOST } from "@/lib/social/threads/auth";
import { PublishError } from "@/lib/jobs/errors";
import type { FetchLike } from "@/lib/oauth/types";
import type { Publisher, PublishInput } from "./types";

async function threadsPost(
  fetchImpl: FetchLike,
  path: string,
  token: string,
  fields: Record<string, string>,
): Promise<string> {
  const url = new URL(`${THREADS_HOST}${path}`);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);

  const response = await fetchImpl(url.toString(), { method: "POST" });
  const json = (await response.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };

  if (!response.ok || !json.id) {
    throw new PublishError(
      json.error?.message ?? `Threads respondio ${response.status}`,
      response.status === 429 || response.status >= 500 ? "temporary" : "permanent",
      response.status,
    );
  }

  return json.id;
}

/** Que tipo de contenedor pide Threads segun la media. */
function mediaTypeFor(input: PublishInput, urls: string[]): Record<string, string> {
  if (urls.length === 0) return { media_type: "TEXT" };

  const kind = input.media[0]?.kind;
  if (urls.length > 1) return { media_type: "CAROUSEL" };
  if (kind === "video") return { media_type: "VIDEO", video_url: urls[0] };
  return { media_type: "IMAGE", image_url: urls[0] };
}

export const threadsPublisher: Publisher = {
  id: "threads_api",
  platforms: ["threads"],

  async publish({ input, credentials, fetchImpl }) {
    const impl = fetchImpl ?? fetch;
    const userId = input.accountRef;
    if (!userId) throw new PublishError("Falta la cuenta de Threads", "permanent");

    // Un hilo: cada parte responde a la anterior. Sin esto, tres partes serian
    // tres posts sueltos y se leerian al reves.
    const parts = Array.isArray(input.options.threadItems)
      ? (input.options.threadItems as string[])
      : [];

    const containerFields: Record<string, string> = {
      text: input.text,
      ...mediaTypeFor(input, input.mediaUrls),
      ...(typeof input.options.replyControl === "string"
        ? { reply_control: input.options.replyControl }
        : {}),
    };

    const containerId = await threadsPost(impl, `/${userId}/threads`, credentials.token, containerFields);
    const publishedId = await threadsPost(impl, `/${userId}/threads_publish`, credentials.token, {
      creation_id: containerId,
    });

    let lastId = publishedId;
    for (const part of parts) {
      const replyContainer = await threadsPost(impl, `/${userId}/threads`, credentials.token, {
        text: part,
        media_type: "TEXT",
        reply_to_id: lastId,
      });
      lastId = await threadsPost(impl, `/${userId}/threads_publish`, credentials.token, {
        creation_id: replyContainer,
      });
    }

    return {
      status: "published",
      externalId: publishedId,
      externalUrl: null,
      ref: publishedId,
    };
  },
};
