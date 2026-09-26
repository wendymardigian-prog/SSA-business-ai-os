/**
 * Publicar en YouTube con la API oficial (F33).
 *
 * Subida reanudable con `fetch` y `Content-Range`, sin `googleapis`: la
 * libreria pesa decenas de megas y trae todo Google para usar dos endpoints.
 *
 * El video se sube EN PARTES y nunca se carga entero en memoria: un video de
 * 800 MB en memoria en un servidor de Railway es un proceso muerto. Se lee
 * del Storage por rangos y se reenvia parte por parte.
 *
 * La trampa de YouTube: si el proyecto de Google no paso la auditoria, un
 * video que se pide `public` queda `private` SIN error. Por eso se lee
 * `status.privacyStatus` despues de subir y se compara con lo pedido. Si no
 * coincide, se avisa y se deshabilita este publicador (F38).
 */

import { PublishError } from "@/lib/jobs/errors";
import type { FetchLike } from "@/lib/oauth/types";
import type { Publisher, PublishInput, PublishResult } from "./types";

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

/** Cada parte de la subida. Multiplo de 256 KB, como pide Google. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

export interface YouTubeMetadata {
  title: string;
  description: string;
  privacyStatus: "public" | "unlisted" | "private";
  madeForKids?: boolean;
  publishAt?: string | null;
  tags?: string[];
}

export function metadataFrom(input: PublishInput): YouTubeMetadata {
  const visibility = input.options.visibility;
  return {
    title: (input.title ?? "").trim() || "Sin titulo",
    description: input.text,
    privacyStatus:
      visibility === "public" || visibility === "unlisted" || visibility === "private"
        ? visibility
        : "private",
    madeForKids: input.options.madeForKids === true,
    publishAt: typeof input.options.publishAt === "string" ? input.options.publishAt : null,
    tags: Array.isArray(input.options.tags) ? (input.options.tags as string[]) : undefined,
  };
}

/** Abre la sesion de subida y devuelve a donde mandar las partes. */
export async function startResumableUpload(params: {
  accessToken: string;
  metadata: YouTubeMetadata;
  sizeBytes: number;
  contentType: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const url = new URL(UPLOAD_URL);
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("part", "snippet,status");

  const response = await (params.fetchImpl ?? fetch)(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Length": String(params.sizeBytes),
      "X-Upload-Content-Type": params.contentType,
    },
    body: JSON.stringify({
      snippet: {
        title: params.metadata.title,
        description: params.metadata.description,
        ...(params.metadata.tags ? { tags: params.metadata.tags } : {}),
      },
      status: {
        privacyStatus: params.metadata.privacyStatus,
        selfDeclaredMadeForKids: params.metadata.madeForKids ?? false,
        ...(params.metadata.publishAt ? { publishAt: params.metadata.publishAt } : {}),
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw classifyYouTubeError(response.status, detail);
  }

  const location = response.headers.get("location");
  if (!location) {
    throw new PublishError("YouTube no devolvio a donde subir el video", "temporary");
  }
  return location;
}

/** El rango de cada parte, en el formato que espera Google. */
export function chunkRanges(sizeBytes: number, chunkBytes = CHUNK_BYTES): Array<{
  start: number;
  end: number;
  header: string;
}> {
  const ranges: Array<{ start: number; end: number; header: string }> = [];
  for (let start = 0; start < sizeBytes; start += chunkBytes) {
    const end = Math.min(start + chunkBytes, sizeBytes) - 1;
    ranges.push({ start, end, header: `bytes ${start}-${end}/${sizeBytes}` });
  }
  return ranges;
}

/**
 * Un 308 significa "recibi hasta aca, segui": es lo normal entre partes.
 * Cualquier otro codigo que no sea 2xx es un problema.
 */
export function isChunkAccepted(status: number): boolean {
  return status === 308 || (status >= 200 && status < 300);
}

export function classifyYouTubeError(status: number, detail: string): PublishError {
  const lower = detail.toLowerCase();

  if (lower.includes("quotaexceeded") || lower.includes("ratelimitexceeded")) {
    // La cuota diaria se renueva: reintentar mañana tiene sentido.
    return new PublishError("Se agoto la cuota diaria de YouTube", "temporary", status);
  }
  if (status === 401 || status === 403) {
    return new PublishError(detail || "YouTube rechazo el acceso", "permanent", status);
  }
  if (status === 429 || status >= 500) {
    return new PublishError(detail || `YouTube respondio ${status}`, "temporary", status);
  }
  return new PublishError(detail || `YouTube respondio ${status}`, "permanent", status);
}

/**
 * Lee como quedo el video despues de subirlo.
 *
 * Es la unica forma de enterarse de que YouTube lo dejo privado sin decir
 * nada, que es lo que pasa cuando el proyecto no paso la auditoria.
 */
export async function readVideoStatus(params: {
  accessToken: string;
  videoId: string;
  fetchImpl?: FetchLike;
}): Promise<{ privacyStatus: string | null; uploadStatus: string | null }> {
  const url = new URL(VIDEOS_URL);
  url.searchParams.set("part", "status");
  url.searchParams.set("id", params.videoId);

  const response = await (params.fetchImpl ?? fetch)(url.toString(), {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });

  if (!response.ok) {
    return { privacyStatus: null, uploadStatus: null };
  }

  const json = (await response.json().catch(() => ({}))) as {
    items?: Array<{ status?: { privacyStatus?: string; uploadStatus?: string } }>;
  };
  const status = json.items?.[0]?.status;
  return {
    privacyStatus: status?.privacyStatus ?? null,
    uploadStatus: status?.uploadStatus ?? null,
  };
}

/** Compara lo pedido con lo que quedo. */
export function visibilityOutcome(
  requested: string,
  actual: string | null,
): { ok: boolean; warning?: string; disablePublisher?: boolean } {
  if (!actual || actual === requested) return { ok: true };

  if (requested !== "private" && actual === "private") {
    // El sintoma exacto de un proyecto sin auditar.
    return {
      ok: false,
      disablePublisher: true,
      warning:
        "YouTube dejo el video en privado. Pasa cuando el proyecto de Google todavia no paso la auditoria: hasta que la pase, conviene publicar por Postproxy.",
    };
  }

  return { ok: false, warning: `Se pidio ${requested} y quedo ${actual}.` };
}

/** Borra un video. Lo usa la prueba de publicacion directa (F38). */
export async function deleteVideo(params: {
  accessToken: string;
  videoId: string;
  fetchImpl?: FetchLike;
}): Promise<boolean> {
  const url = new URL(VIDEOS_URL);
  url.searchParams.set("id", params.videoId);

  const response = await (params.fetchImpl ?? fetch)(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });

  return response.ok || response.status === 204;
}

/** De donde salen los bytes de cada parte. */
export type ChunkReader = (start: number, end: number) => Promise<ArrayBuffer>;

/**
 * Sube el video entero, parte por parte.
 *
 * Devuelve el id del video. El que lee los bytes es quien llama: asi este
 * modulo no sabe de Storage y se puede probar con un lector de mentira.
 */
export async function uploadInChunks(params: {
  uploadUrl: string;
  sizeBytes: number;
  read: ChunkReader;
  fetchImpl?: FetchLike;
  chunkBytes?: number;
}): Promise<string> {
  const impl = params.fetchImpl ?? fetch;
  const ranges = chunkRanges(params.sizeBytes, params.chunkBytes ?? CHUNK_BYTES);

  for (const range of ranges) {
    const body = await params.read(range.start, range.end);
    const response = await impl(params.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": range.header,
      },
      body,
    });

    if (!isChunkAccepted(response.status)) {
      const detail = await response.text().catch(() => "");
      throw classifyYouTubeError(response.status, detail);
    }

    // La ultima parte devuelve el video ya creado.
    if (response.status >= 200 && response.status < 300) {
      const json = (await response.json().catch(() => ({}))) as { id?: string };
      if (json.id) return json.id;
    }
  }

  throw new PublishError("YouTube no devolvio el id del video", "temporary");
}

export interface YouTubePublisherDeps {
  /** Lee los bytes del video desde donde esten guardados. */
  createReader(url: string): Promise<{ read: ChunkReader; sizeBytes: number; contentType: string }>;
  /** Tamaño de cada parte. Solo se cambia en los tests. */
  chunkBytes?: number;
}

/**
 * El publicador. Recibe como leer el archivo, para no depender de Storage.
 */
export function createYouTubePublisher(deps: YouTubePublisherDeps): Publisher {
  return {
    id: "youtube_api",
    platforms: ["youtube"],

    async publish({ input, credentials, fetchImpl }): Promise<PublishResult> {
      const source = input.mediaUrls[0];
      if (!source) throw new PublishError("YouTube necesita un video", "permanent");

      const metadata = metadataFrom(input);
      const file = await deps.createReader(source);

      const uploadUrl = await startResumableUpload({
        accessToken: credentials.token,
        metadata,
        sizeBytes: file.sizeBytes,
        contentType: file.contentType,
        fetchImpl,
      });

      const videoId = await uploadInChunks({
        uploadUrl,
        sizeBytes: file.sizeBytes,
        read: file.read,
        fetchImpl,
        chunkBytes: deps.chunkBytes,
      });

      const status = await readVideoStatus({
        accessToken: credentials.token,
        videoId,
        fetchImpl,
      });

      const outcome = visibilityOutcome(metadata.privacyStatus, status.privacyStatus);

      return {
        status: "published",
        externalId: videoId,
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        ref: videoId,
        actualVisibility: status.privacyStatus,
        warning: outcome.warning ?? null,
      };
    },
  };
}
