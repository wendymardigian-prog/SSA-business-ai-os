/**
 * La prueba de publicacion directa en YouTube (F38).
 *
 * El problema que resuelve: la API de YouTube acepta `privacyStatus: public`
 * de un proyecto de Google sin auditar, sube el video, devuelve 200 y lo deja
 * PRIVADO. No hay error, no hay aviso. La primera vez que se nota es cuando
 * un cliente pregunta por que no ve el video.
 *
 * La unica forma de saberlo antes es probarlo: subir un video de un segundo
 * pidiendo `unlisted`, leer como quedo, y borrarlo. Si quedo como se pidio,
 * el publicador queda verificado; si no, queda deshabilitado con el motivo, y
 * YouTube publica por Postproxy hasta que el proyecto pase la auditoria.
 *
 * Se aprieta a mano desde Integraciones, no corre solo: sube un video a la
 * cuenta real de la persona y eso no se hace sin que lo pidan.
 */

import type { FetchLike } from "@/lib/oauth/types";
import { classifyPublishError } from "@/lib/jobs/errors";
import type { PublisherEntry, PublisherStatus } from "@/lib/social/accounts-schema";
import {
  deleteVideo,
  readVideoStatus,
  startResumableUpload,
  uploadInChunks,
  visibilityOutcome,
  type ChunkReader,
} from "./youtube";

/** Se pide `unlisted` y no `public`: la prueba no tiene que aparecerle a nadie. */
export const PROBE_VISIBILITY = "unlisted" as const;

export const PROBE_TITLE = "Prueba de conexion (borrar)";

export interface ProbeOutcome {
  /** La subida directa funciona y deja el video como se pide. */
  ok: boolean;
  status: PublisherStatus;
  /** Que paso, en palabras, para mostrarlo en la card. */
  message: string;
  /** El video de prueba se pudo borrar. */
  cleanedUp: boolean;
  videoId: string | null;
}

/**
 * Como queda el publicador despues de la prueba.
 *
 * Separado de la prueba misma para poder fijar la tabla sin subir nada.
 */
export function outcomeFrom(params: {
  videoId: string | null;
  actualVisibility: string | null;
  cleanedUp: boolean;
  error?: string;
}): ProbeOutcome {
  if (params.error || !params.videoId) {
    return {
      ok: false,
      status: "unavailable",
      message: params.error ?? "No pude subir el video de prueba.",
      cleanedUp: params.cleanedUp,
      videoId: params.videoId,
    };
  }

  const visibility = visibilityOutcome(PROBE_VISIBILITY, params.actualVisibility);
  if (!visibility.ok) {
    return {
      ok: false,
      status: "unavailable",
      message:
        visibility.warning ??
        "YouTube no dejo el video como se pidio. Hasta que el proyecto pase la auditoria, conviene publicar por Postproxy.",
      cleanedUp: params.cleanedUp,
      videoId: params.videoId,
    };
  }

  return {
    ok: true,
    status: "available",
    message: params.cleanedUp
      ? "La subida directa funciona. El video de prueba se borro."
      : "La subida directa funciona, pero no pude borrar el video de prueba: borralo desde YouTube Studio.",
    cleanedUp: params.cleanedUp,
    videoId: params.videoId,
  };
}

/** Deja la entrada del publicador como la dejo la prueba. */
export function applyProbe(
  entries: PublisherEntry[],
  outcome: ProbeOutcome,
  now: string,
): PublisherEntry[] {
  return entries.map((entry) =>
    entry.publisher === "youtube_api"
      ? {
          ...entry,
          status: outcome.status,
          status_reason: outcome.ok ? null : outcome.message,
          verified_at: outcome.ok ? now : entry.verified_at,
          // Una prueba fallida NO pisa una habilitacion manual: si alguien
          // decidio usarlo igual, la prueba informa pero no manda.
          manually_enabled: entry.manually_enabled,
        }
      : entry,
  );
}

export interface ProbeDeps {
  accessToken: string;
  /** Los bytes del video de un segundo. */
  video: { sizeBytes: number; contentType: string; read: ChunkReader };
  fetchImpl?: FetchLike;
}

/**
 * Sube, lee como quedo y borra.
 *
 * El borrado va SIEMPRE, incluso si la lectura fallo: un video de prueba
 * olvidado en el canal del cliente es basura que dejamos nosotros.
 */
export async function runYouTubeProbe(deps: ProbeDeps): Promise<ProbeOutcome> {
  let videoId: string | null = null;

  try {
    const uploadUrl = await startResumableUpload({
      accessToken: deps.accessToken,
      metadata: {
        title: PROBE_TITLE,
        description: "Video de prueba del sistema. Se borra solo.",
        privacyStatus: PROBE_VISIBILITY,
        madeForKids: false,
      },
      sizeBytes: deps.video.sizeBytes,
      contentType: deps.video.contentType,
      fetchImpl: deps.fetchImpl,
    });

    videoId = await uploadInChunks({
      uploadUrl,
      sizeBytes: deps.video.sizeBytes,
      read: deps.video.read,
      fetchImpl: deps.fetchImpl,
    });

    const status = await readVideoStatus({
      accessToken: deps.accessToken,
      videoId,
      fetchImpl: deps.fetchImpl,
    });

    const cleanedUp = await deleteVideo({
      accessToken: deps.accessToken,
      videoId,
      fetchImpl: deps.fetchImpl,
    }).catch(() => false);

    return outcomeFrom({ videoId, actualVisibility: status.privacyStatus, cleanedUp });
  } catch (err) {
    const error = classifyPublishError(err);

    // Si el video llego a crearse antes del fallo, igual se borra.
    const cleanedUp = videoId
      ? await deleteVideo({
          accessToken: deps.accessToken,
          videoId,
          fetchImpl: deps.fetchImpl,
        }).catch(() => false)
      : true;

    return outcomeFrom({ videoId, actualVisibility: null, cleanedUp, error: error.message });
  }
}
