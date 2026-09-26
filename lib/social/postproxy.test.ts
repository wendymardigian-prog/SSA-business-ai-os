/**
 * Cliente de Postproxy (F14), con la API simulada.
 *
 * Los casos son los que deciden si una publicacion se pierde o se reintenta:
 * que error es temporal y cual no, y como se lee el resultado por red.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createPost,
  getPost,
  listProfiles,
  platformOutcome,
  PostproxyError,
  POSTPROXY_BASE,
  testApiKey,
} from "./postproxy";

function fakeFetch(...responses: Array<{ status?: number; body?: unknown; throws?: Error }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue = [...responses];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 500 };
    if (next.throws) throw next.throws;
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      json: async () => next.body ?? {},
    } as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const bodyOf = (call: { init?: RequestInit }) => JSON.parse(String(call.init?.body ?? "{}"));

describe("hablar con Postproxy", () => {
  it("manda la API key como Bearer", async () => {
    const f = fakeFetch({ body: { profiles: [] } });

    await listProfiles("clave-123", f.impl);

    expect(f.calls[0].url).toBe(`${POSTPROXY_BASE}/profiles`);
    expect((f.calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer clave-123");
  });

  it("una clave invalida se dice en palabras al conectar", async () => {
    // Enterarse el dia que falla una publicacion es tarde.
    const f = fakeFetch({ status: 401, body: { error: "Unauthorized" } });

    expect(await testApiKey("clave-mala", f.impl)).toEqual({
      ok: false,
      error: expect.stringContaining("no reconoce"),
    });
  });

  it("una clave valida devuelve los perfiles conectados", async () => {
    const f = fakeFetch({ body: { profiles: [{ id: "p1", platform: "youtube", username: "micanal" }] } });

    const result = await testApiKey("clave-buena", f.impl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profiles[0].platform).toBe("youtube");
  });
});

describe("crear una publicacion", () => {
  it("manda el cuerpo con la forma que documenta Postproxy", async () => {
    const f = fakeFetch({ body: { id: "post-1", status: "scheduled" } });

    await createPost({
      apiKey: "k",
      body: "La descripcion del video",
      profiles: ["youtube"],
      media: ["https://storage.test/video.mp4"],
      scheduledAt: "2026-10-01T15:00:00.000Z",
      fetchImpl: f.impl,
    });

    expect(bodyOf(f.calls[0])).toEqual({
      post: { body: "La descripcion del video", scheduled_at: "2026-10-01T15:00:00.000Z" },
      profiles: ["youtube"],
      media: ["https://storage.test/video.mp4"],
    });
  });

  it("sin fecha se publica al recibirlo", async () => {
    const f = fakeFetch({ body: { id: "post-1", status: "published" } });

    await createPost({ apiKey: "k", body: "x", profiles: ["youtube"], fetchImpl: f.impl });

    expect(bodyOf(f.calls[0]).post.scheduled_at).toBeUndefined();
  });

  it("una respuesta sin id es un error: no hay que quedarse esperando algo que no existe", async () => {
    const f = fakeFetch({ body: { status: "ok" } });

    await expect(
      createPost({ apiKey: "k", body: "x", profiles: ["youtube"], fetchImpl: f.impl }),
    ).rejects.toThrow(/no devolvio el id/);
  });
});

describe("que errores se reintentan", () => {
  it("429 y 5xx son temporales", async () => {
    for (const status of [429, 500, 503]) {
      const f = fakeFetch({ status, body: {} });
      const error = await listProfiles("k", f.impl).catch((e) => e);

      expect(error).toBeInstanceOf(PostproxyError);
      expect(error.temporary).toBe(true);
    }
  });

  it("401 y 400 no se reintentan: no van a mejorar solos", async () => {
    for (const status of [400, 401, 403]) {
      const f = fakeFetch({ status, body: { error: "no" } });
      const error = await listProfiles("k", f.impl).catch((e) => e);

      expect(error.temporary).toBe(false);
    }
  });

  it("si la red se corta, es temporal: no se sabe si llego", async () => {
    const f = fakeFetch({ throws: new Error("ECONNRESET") });
    const error = await listProfiles("k", f.impl).catch((e) => e);

    expect(error.temporary).toBe(true);
    expect(error.status).toBe(0);
  });
});

describe("como quedo cada red", () => {
  const post = (platforms: unknown) =>
    ({ id: "p", status: "published", platforms }) as Parameters<typeof platformOutcome>[0];

  it("publicada", () => {
    expect(platformOutcome(post([{ platform: "youtube", status: "published" }]), "youtube")).toEqual({
      status: "published",
      error: null,
    });
  });

  it("con error, y se conserva el motivo", () => {
    expect(
      platformOutcome(
        post([{ platform: "youtube", status: "error", error: "El video supera la duracion" }]),
        "youtube",
      ),
    ).toEqual({ status: "failed", error: "El video supera la duracion" });
  });

  it("todavia sin resultado es 'en curso', no 'fallo'", () => {
    // Tratarlo como fallo publicaria dos veces al reintentar.
    expect(platformOutcome(post([]), "youtube").status).toBe("processing");
    expect(platformOutcome(post(undefined), "youtube").status).toBe("processing");
    expect(platformOutcome(post([{ platform: "youtube", status: "processing" }]), "youtube").status).toBe(
      "processing",
    );
  });
});

describe("consultar el estado", () => {
  it("pregunta por el id de la publicacion", async () => {
    const f = fakeFetch({ body: { id: "post-1", status: "published", platforms: [] } });

    await getPost("k", "post-1", f.impl);

    expect(f.calls[0].url).toBe(`${POSTPROXY_BASE}/posts/post-1`);
  });
});
