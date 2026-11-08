/**
 * El archivo del video de un anuncio, pedido a Meta en el momento (noviembre 2026, 00323).
 *
 * No se guarda una copia: el link que da Meta vence en unas horas y un video pesa decenas de MB.
 * Se pide cada vez que alguien lo quiere ver o bajar (y mas adelante, cuando se transcriba solo,
 * el job lo va a pedir igual). Tres caminos, en orden:
 *
 * 1. `/{video_id}?fields=source,length`: el mp4 del video del creativo. Es el camino normal.
 * 2. Si no hay `video_id` guardado (un anuncio que el sync todavia no releyo), se le pregunta a Meta
 *    por el creativo del anuncio y se sigue con el 1.
 * 3. Si Meta no da el `source` (permisos de la pagina, por ejemplo) y el anuncio promociona una
 *    publicacion de Instagram, `/{ig_media_id}?fields=media_type,media_url`: el video de esa publicacion.
 *    Instagram no da `media_url` de un video con musica con derechos: ahi no hay archivo.
 *
 * Un error del grafo vuelve como resultado, nunca como excepcion (ver `graph.ts`). Modulo puro: no sabe
 * de Supabase ni de Vault; el token lo pasa quien llama.
 */

import { graphGet, humanizeGraphError, isTransientGraphError, type GraphError } from "./graph";
import { creativeVideoId } from "./entities";

export type AdVideoOrigin = "ad_video" | "instagram";

export type AdVideoResult =
  | {
      ok: true;
      /** El link del mp4. Vence en unas horas: no se guarda. */
      url: string;
      origin: AdVideoOrigin;
      /** Lo que Meta encontro del id del video, para guardarlo si faltaba. */
      videoId: string | null;
      /** Duracion en segundos, si Meta la dio. */
      durationSeconds: number | null;
    }
  | {
      ok: false;
      /** `not_video`: el anuncio no tiene video. `unavailable`: lo tiene, pero Meta no dio el archivo. */
      code: "not_video" | "unavailable";
      message: string;
      retryable: boolean;
      videoId: string | null;
    };

const NOT_VIDEO = "Este anuncio no tiene un video.";
const UNAVAILABLE = "Meta no nos dio el archivo de este video.";

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

export async function fetchAdVideoSource(params: {
  token: string;
  adId: string;
  videoId: string | null;
  instagramMediaId: string | null;
  fetchImpl?: typeof fetch;
}): Promise<AdVideoResult> {
  const { token, fetchImpl } = params;
  let videoId = text(params.videoId);
  let lastError: GraphError | null = null;

  // 2. Sin id guardado: se le pregunta al anuncio por su creativo.
  if (!videoId) {
    const ad = await graphGet<{ creative?: Parameters<typeof creativeVideoId>[0] }>(
      params.adId,
      token,
      { fields: "creative{video_id,object_story_spec{video_data{video_id}},asset_feed_spec{videos{video_id}}}" },
      fetchImpl,
    );
    if (ad.ok) videoId = creativeVideoId(ad.data.creative);
    else lastError = ad.error;
  }

  // 1. El video del creativo.
  if (videoId) {
    const video = await graphGet<{ source?: string; length?: number }>(videoId, token, { fields: "source,length" }, fetchImpl);
    if (video.ok && text(video.data.source)) {
      return {
        ok: true,
        url: video.data.source as string,
        origin: "ad_video",
        videoId,
        durationSeconds: typeof video.data.length === "number" && Number.isFinite(video.data.length) ? video.data.length : null,
      };
    }
    if (!video.ok) lastError = video.error;
  }

  // 3. La publicacion de Instagram que promociona.
  const igId = text(params.instagramMediaId);
  if (igId) {
    const media = await graphGet<{ media_type?: string; media_url?: string }>(igId, token, { fields: "media_type,media_url" }, fetchImpl);
    if (media.ok) {
      const isVideo = media.data.media_type === "VIDEO" || media.data.media_type === "REELS";
      if (isVideo && text(media.data.media_url)) {
        return { ok: true, url: media.data.media_url as string, origin: "instagram", videoId, durationSeconds: null };
      }
      // La publicacion es una imagen o un carrusel, y el creativo no tenia video: no es un video.
      if (!isVideo && !videoId) return { ok: false, code: "not_video", message: NOT_VIDEO, retryable: false, videoId: null };
    } else {
      lastError = media.error;
    }
  }

  if (!videoId && !igId && !lastError) return { ok: false, code: "not_video", message: NOT_VIDEO, retryable: false, videoId: null };

  return {
    ok: false,
    code: "unavailable",
    message: lastError ? `${UNAVAILABLE} ${humanizeGraphError(lastError)}` : UNAVAILABLE,
    retryable: lastError ? isTransientGraphError(lastError) : false,
    videoId,
  };
}
