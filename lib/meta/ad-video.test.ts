import { describe, expect, it, vi } from "vitest";
import { fetchAdVideoSource } from "./ad-video";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Un fetch falso que contesta segun el objeto que se pide (el primer tramo de la ruta). */
function graph(answers: Record<string, unknown>) {
  return vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    const id = url.pathname.split("/").filter(Boolean)[1];
    return json(answers[id] ?? { error: { message: "no existe", code: 100 } });
  });
}

describe("fetchAdVideoSource", () => {
  it("con el id del video guardado, devuelve el mp4 de Meta y su duracion", async () => {
    const fetchImpl = graph({ v1: { source: "https://video.fbcdn.net/v1.mp4", length: 31.5 } });
    const result = await fetchAdVideoSource({ token: "t", adId: "a1", videoId: "v1", instagramMediaId: null, fetchImpl });
    expect(result).toEqual({ ok: true, url: "https://video.fbcdn.net/v1.mp4", origin: "ad_video", videoId: "v1", durationSeconds: 31.5 });
    // No le pregunta al anuncio si ya sabe el video.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("fields=source%2Clength");
  });

  it("sin id guardado, lo busca en el creativo del anuncio y lo devuelve para guardarlo", async () => {
    const fetchImpl = graph({
      a1: { creative: { object_story_spec: { video_data: { video_id: "v2" } } } },
      v2: { source: "https://video.fbcdn.net/v2.mp4" },
    });
    const result = await fetchAdVideoSource({ token: "t", adId: "a1", videoId: null, instagramMediaId: null, fetchImpl });
    expect(result).toMatchObject({ ok: true, videoId: "v2", origin: "ad_video", durationSeconds: null });
  });

  it("si Meta no da el archivo del video, prueba con la publicacion de Instagram", async () => {
    const fetchImpl = graph({
      v1: { error: { message: "Unsupported get request", code: 100 } },
      ig1: { media_type: "VIDEO", media_url: "https://scontent.cdninstagram.com/ig1.mp4" },
    });
    const result = await fetchAdVideoSource({ token: "t", adId: "a1", videoId: "v1", instagramMediaId: "ig1", fetchImpl });
    expect(result).toMatchObject({ ok: true, origin: "instagram", url: "https://scontent.cdninstagram.com/ig1.mp4", videoId: "v1" });
  });

  it("una publicacion de imagen sin video en el creativo no es un video", async () => {
    const fetchImpl = graph({ a1: { creative: {} }, ig1: { media_type: "IMAGE", media_url: "https://x/ig1.jpg" } });
    const result = await fetchAdVideoSource({ token: "t", adId: "a1", videoId: null, instagramMediaId: "ig1", fetchImpl });
    expect(result).toMatchObject({ ok: false, code: "not_video", retryable: false });
  });

  it("un anuncio sin video ni publicacion no es un video", async () => {
    const fetchImpl = graph({ a1: { creative: { video_id: "" } } });
    const result = await fetchAdVideoSource({ token: "t", adId: "a1", videoId: null, instagramMediaId: null, fetchImpl });
    expect(result).toMatchObject({ ok: false, code: "not_video" });
  });

  it("un video sin archivo (permisos) lo dice en palabras, sin lanzar", async () => {
    const fetchImpl = graph({ v1: { error: { message: "permisos", code: 10 } }, ig1: { media_type: "VIDEO" } });
    const result = await fetchAdVideoSource({ token: "t", adId: "a1", videoId: "v1", instagramMediaId: "ig1", fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unavailable");
      expect(result.videoId).toBe("v1");
      expect(result.retryable).toBe(false);
    }
  });

  it("un limite de uso de Meta se puede reintentar", async () => {
    const fetchImpl = graph({ v1: { error: { message: "too many calls", code: 17 } } });
    const result = await fetchAdVideoSource({ token: "t", adId: "a1", videoId: "v1", instagramMediaId: null, fetchImpl });
    expect(result).toMatchObject({ ok: false, code: "unavailable", retryable: true });
  });

  it("una caida de red no lanza", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const result = await fetchAdVideoSource({ token: "t", adId: "a1", videoId: "v1", instagramMediaId: null, fetchImpl });
    expect(result).toMatchObject({ ok: false, code: "unavailable" });
  });
});
