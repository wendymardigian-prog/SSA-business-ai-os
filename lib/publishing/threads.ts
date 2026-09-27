/**
 * Publicar en Threads (F34, A10).
 *
 * Dos pasos, como toda la familia de Meta: se crea un contenedor y despues se
 * publica. Un hilo son varios posts encadenados, cada uno respondiendo al
 * anterior.
 *
 * Tres cosas que antes salian mal:
 *
 * 1. **El carrusel iba sin hijos.** Se mandaba `media_type=CAROUSEL` a secas,
 *    y Meta lo rechaza con 400. Un carrusel se arma creando un contenedor por
 *    imagen (`is_carousel_item`) y pasando sus ids en `children`.
 * 2. **El video se publicaba sin esperar.** Meta procesa el video despues de
 *    crear el contenedor; publicarlo antes de que quede `FINISHED` falla. Se
 *    espera un rato y, si tarda mas, la publicacion queda en proceso y la
 *    revision la termina.
 * 3. **Un hilo que fallaba a la mitad se duplicaba.** El reintento volvia a
 *    empezar desde el post principal, que ya estaba publicado. Ahora cada
 *    paso queda anotado en `progress` y el reintento arranca donde quedo.
 *
 * Portado de ScaleOS (`_shared/threads.ts`), adaptado a la interfaz comun.
 */

import { THREADS_HOST } from "@/lib/social/threads/auth";
import { PublishError } from "@/lib/jobs/errors";
import type { FetchLike } from "@/lib/oauth/types";
import type { Publisher, PublishInput, PublishResult } from "./types";

/** Cuantas veces se pregunta si el video termino de procesarse, y cada cuanto. */
export const CONTAINER_POLLS = 5;
export const CONTAINER_POLL_MS = 2000;

/** Lo que Threads deja anotado entre un intento y el siguiente. */
export interface ThreadsProgress {
  /** Ids de los contenedores hijos del carrusel, ya creados. */
  childIds?: string[];
  /** El contenedor raiz, ya creado. */
  containerId?: string;
  /** El post principal, ya publicado. */
  rootId?: string;
  /** Cuantas respuestas del hilo ya salieron. */
  parts?: number;
  /** El id de la ultima parte publicada, al que responde la siguiente. */
  lastId?: string;
}

function readProgress(input: PublishInput): ThreadsProgress {
  const raw = input.progress;
  return raw && typeof raw === "object" ? (raw as ThreadsProgress) : {};
}

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

/** En que anda el contenedor: Meta procesa el video en segundo plano. */
export async function containerStatus(
  fetchImpl: FetchLike,
  containerId: string,
  token: string,
): Promise<{ status: string; error: string | null }> {
  const url = new URL(`${THREADS_HOST}/${containerId}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "status,error_message");

  const response = await fetchImpl(url.toString(), { method: "GET" });
  const json = (await response.json().catch(() => ({}))) as {
    status?: string;
    error_message?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new PublishError(
      json.error?.message ?? `Threads respondio ${response.status}`,
      response.status === 429 || response.status >= 500 ? "temporary" : "permanent",
      response.status,
    );
  }

  return { status: json.status ?? "FINISHED", error: json.error_message ?? null };
}

/**
 * Espera a que el contenedor termine de procesarse.
 *
 * Devuelve `ready: false` cuando sigue trabajando: ahi la publicacion queda
 * en proceso y la revision la retoma, en vez de esperar cinco minutos dentro
 * de la corrida del cron y frenar todo lo demas.
 */
async function waitForContainer(
  fetchImpl: FetchLike,
  containerId: string,
  token: string,
  sleep: (ms: number) => Promise<void>,
): Promise<{ ready: boolean }> {
  for (let attempt = 0; attempt < CONTAINER_POLLS; attempt++) {
    const { status, error } = await containerStatus(fetchImpl, containerId, token);
    if (status === "FINISHED") return { ready: true };
    if (status === "ERROR" || status === "EXPIRED") {
      throw new PublishError(error ?? `Threads no pudo procesar la media (${status})`, "permanent");
    }
    await sleep(CONTAINER_POLL_MS);
  }
  return { ready: false };
}

/** Si la media necesita que Meta la procese antes de publicar. */
function needsProcessing(input: PublishInput): boolean {
  return input.media.some((m) => m.kind === "video");
}

export interface ThreadsDeps {
  /** Inyectable para que los tests no esperen de verdad. */
  sleep?: (ms: number) => Promise<void>;
}

export function createThreadsPublisher(deps: ThreadsDeps = {}): Publisher {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function buildRootContainer(
    impl: FetchLike,
    userId: string,
    token: string,
    input: PublishInput,
    progress: ThreadsProgress,
  ): Promise<string> {
    if (progress.containerId) return progress.containerId;

    const urls = input.mediaUrls;
    const replyControl: Record<string, string> =
      typeof input.options.replyControl === "string"
        ? { reply_control: input.options.replyControl }
        : {};

    // Carrusel: primero un contenedor por item, despues el que los agrupa.
    if (urls.length > 1) {
      const childIds = progress.childIds ?? [];
      for (let i = childIds.length; i < urls.length; i++) {
        const kind = input.media[i]?.kind;
        const id = await threadsPost(impl, `/${userId}/threads`, token, {
          is_carousel_item: "true",
          media_type: kind === "video" ? "VIDEO" : "IMAGE",
          ...(kind === "video" ? { video_url: urls[i] } : { image_url: urls[i] }),
        });
        childIds.push(id);
        progress.childIds = childIds;
      }

      return threadsPost(impl, `/${userId}/threads`, token, {
        media_type: "CAROUSEL",
        children: childIds.join(","),
        text: input.text,
        ...replyControl,
      });
    }

    const kind = input.media[0]?.kind;
    const mediaFields: Record<string, string> =
      urls.length === 0
        ? { media_type: "TEXT" }
        : kind === "video"
          ? { media_type: "VIDEO", video_url: urls[0] }
          : { media_type: "IMAGE", image_url: urls[0] };

    return threadsPost(impl, `/${userId}/threads`, token, {
      text: input.text,
      ...mediaFields,
      ...replyControl,
    });
  }

  return {
    id: "threads_api",
    platforms: ["threads"],

    async publish({ input, credentials, fetchImpl }): Promise<PublishResult> {
      const impl = fetchImpl ?? fetch;
      const userId = input.accountRef;
      if (!userId) throw new PublishError("Falta la cuenta de Threads", "permanent");

      const token = credentials.token;
      const progress = readProgress(input);

      // Un hilo: cada parte responde a la anterior. Sin esto, tres partes
      // serian tres posts sueltos y se leerian al reves.
      const parts = Array.isArray(input.options.threadItems)
        ? (input.options.threadItems as string[])
        : [];

      // ── El post principal, si todavia no salio ────────────────────────
      let rootId = progress.rootId;

      if (!rootId) {
        const containerId = await buildRootContainer(impl, userId, token, input, progress);
        progress.containerId = containerId;

        if (needsProcessing(input)) {
          const { ready } = await waitForContainer(impl, containerId, token, sleep);
          if (!ready) {
            // Sigue procesando: la revision lo retoma con el contenedor ya
            // creado, sin volver a subir nada.
            return { status: "processing", ref: containerId, progress: { ...progress } };
          }
        }

        rootId = await threadsPost(impl, `/${userId}/threads_publish`, token, {
          creation_id: containerId,
        });
        progress.rootId = rootId;
        progress.lastId = rootId;
      }

      // ── Las respuestas del hilo, desde donde se corto ─────────────────
      let lastId = progress.lastId ?? rootId;
      for (let i = progress.parts ?? 0; i < parts.length; i++) {
        const replyContainer = await threadsPost(impl, `/${userId}/threads`, token, {
          text: parts[i],
          media_type: "TEXT",
          reply_to_id: lastId,
        });
        lastId = await threadsPost(impl, `/${userId}/threads_publish`, token, {
          creation_id: replyContainer,
        });
        progress.parts = i + 1;
        progress.lastId = lastId;
      }

      return {
        status: "published",
        externalId: rootId,
        externalUrl: null,
        ref: rootId,
      };
    },

    /**
     * Retoma un contenedor que habia quedado procesando.
     *
     * Solo publica: las respuestas del hilo se agregan en el intento
     * siguiente, con el progreso ya guardado.
     */
    async getStatus({ ref, credentials, fetchImpl }): Promise<PublishResult> {
      const impl = fetchImpl ?? fetch;
      const { status, error } = await containerStatus(impl, ref, credentials.token);

      if (status === "ERROR" || status === "EXPIRED") {
        return {
          status: "failed",
          error: error ?? `Threads no pudo procesar la media (${status})`,
          errorKind: "permanent",
        };
      }
      if (status !== "FINISHED") return { status: "processing", ref };

      return { status: "processing", ref, warning: "El contenedor esta listo para publicarse." };
    },
  };
}

export const threadsPublisher = createThreadsPublisher();
