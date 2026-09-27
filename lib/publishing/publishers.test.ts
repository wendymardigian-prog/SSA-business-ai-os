/**
 * Los publicadores, con cada proveedor simulado (F31 a F34).
 *
 * Ninguna llamada real. Lo que se prueba es lo que decide cada publicador
 * cuando el proveedor contesta cosas raras: si algo quedo en proceso, si un
 * error se reintenta, y —en YouTube— si el video quedo como se pidio.
 */

import { describe, it, expect, vi } from "vitest";
import { zernioPublisher } from "./zernio";
import { postproxyPublisher } from "./postproxy";
import { linkedinPublisher } from "./linkedin";
import { threadsPublisher, createThreadsPublisher, CONTAINER_POLLS } from "./threads";
import {
  chunkRanges,
  classifyYouTubeError,
  createYouTubePublisher,
  isChunkAccepted,
  metadataFrom,
  visibilityOutcome,
} from "./youtube";
import type { PublishInput } from "./types";
import { PublishError } from "@/lib/jobs/errors";

const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  platform: "instagram",
  text: "Un caption",
  media: [{ storage_path: "ws/p/v.mp4", mime_type: "video/mp4", kind: "video", size_bytes: 100 }],
  mediaUrls: ["https://storage.test/v.mp4"],
  options: {},
  accountRef: "acc-1",
  ...over,
});

function fakeFetch(...responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string>; text?: string }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue = [...responses];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift() ?? { status: 500 };
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      headers: { get: (k: string) => next.headers?.[k.toLowerCase()] ?? null },
      json: async () => next.body ?? {},
      text: async () => next.text ?? "",
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

// ── Zernio ────────────────────────────────────────────────────────────────

const { createZernioClient } = vi.hoisted(() => ({ createZernioClient: vi.fn() }));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient }));

function zernioResponding(result: { data?: unknown; error?: unknown }) {
  const createPost = vi.fn().mockResolvedValue(result);
  const getPost = vi.fn().mockResolvedValue(result);
  createZernioClient.mockReturnValue({ posts: { createPost, getPost } });
  return { createPost, getPost };
}

describe("publicador de Zernio (F31)", () => {
  it("una publicacion aceptada queda en proceso con su referencia", async () => {
    // El estado final llega por webhook: darla por publicada ahora seria
    // inventar un resultado.
    zernioResponding({ data: { post: { _id: "z1", platforms: [{ platform: "instagram", status: "pending" }] } } });

    const result = await zernioPublisher.publish({
      input: input(),
      credentials: { token: "k" },
    });

    expect(result).toMatchObject({ status: "processing", ref: "z1" });
  });

  it("si ya salio, devuelve el id y el link de la red", async () => {
    zernioResponding({
      data: {
        post: {
          _id: "z1",
          platforms: [
            { platform: "instagram", status: "published", platformPostId: "ig-1", platformPostUrl: "https://ig/1" },
          ],
        },
      },
    });

    const result = await zernioPublisher.publish({ input: input(), credentials: { token: "k" } });

    expect(result).toMatchObject({
      status: "published",
      externalId: "ig-1",
      externalUrl: "https://ig/1",
    });
  });

  it("las opciones de TikTok viajan como las nombra el SDK", async () => {
    const { createPost } = zernioResponding({ data: { post: { _id: "z1" } } });

    await zernioPublisher.publish({
      input: input({ platform: "tiktok", options: { mode: "draft", allowDuet: false } }),
      credentials: { token: "k" },
    });

    const body = createPost.mock.calls[0][0].body;
    expect(body.platforms[0].platformSpecificData).toEqual({ draft: true, allowDuet: false });
  });

  it("se publica una sola red por vez: un fallo de TikTok no arrastra a Instagram", async () => {
    const { createPost } = zernioResponding({ data: { post: { _id: "z1" } } });

    await zernioPublisher.publish({ input: input(), credentials: { token: "k" } });

    expect(createPost.mock.calls[0][0].body.platforms).toHaveLength(1);
  });

  it("publica en el momento: la espera la maneja nuestra cola", async () => {
    const { createPost } = zernioResponding({ data: { post: { _id: "z1" } } });

    await zernioPublisher.publish({ input: input(), credentials: { token: "k" } });

    expect(createPost.mock.calls[0][0].body.publishNow).toBe(true);
  });

  it("un 429 del proveedor es temporal; un 400, permanente", async () => {
    zernioResponding({ error: { status: 429, message: "slow down" } });
    await expect(zernioPublisher.publish({ input: input(), credentials: { token: "k" } })).rejects.toMatchObject(
      { kind: "temporary" },
    );

    zernioResponding({ error: { status: 400, message: "bad" } });
    await expect(zernioPublisher.publish({ input: input(), credentials: { token: "k" } })).rejects.toMatchObject(
      { kind: "permanent" },
    );
  });

  it("sin cuenta no se intenta publicar", async () => {
    zernioResponding({ data: {} });

    await expect(
      zernioPublisher.publish({ input: input({ accountRef: null }), credentials: { token: "k" } }),
    ).rejects.toBeInstanceOf(PublishError);
  });
});

// ── Postproxy ─────────────────────────────────────────────────────────────

describe("publicador de Postproxy (F32)", () => {
  it("manda el titulo y la descripcion en el unico campo de texto que hay", async () => {
    const f = fakeFetch({ body: { id: "pp-1", status: "scheduled" } });

    await postproxyPublisher.publish({
      input: input({ platform: "youtube", title: "Mi video", text: "La descripcion" }),
      credentials: { token: "k" },
      fetchImpl: f.impl,
    });

    const body = JSON.parse(String(f.calls[0].init?.body));
    expect(body.post.body).toContain("Mi video");
    expect(body.post.body).toContain("La descripcion");
  });

  it("sin resultado todavia queda en proceso", async () => {
    const f = fakeFetch({ body: { id: "pp-1", status: "scheduled", platforms: [] } });

    const result = await postproxyPublisher.publish({
      input: input({ platform: "youtube", title: "t" }),
      credentials: { token: "k" },
      fetchImpl: f.impl,
    });

    expect(result).toMatchObject({ status: "processing", ref: "pp-1" });
  });

  it("sin video no se intenta", async () => {
    await expect(
      postproxyPublisher.publish({
        input: input({ platform: "youtube", mediaUrls: [] }),
        credentials: { token: "k" },
      }),
    ).rejects.toThrow(/necesita un video/);
  });
});

// ── LinkedIn ──────────────────────────────────────────────────────────────

describe("publicador de LinkedIn (F34)", () => {
  it("publica texto y devuelve el id que viene en la cabecera", async () => {
    const f = fakeFetch({ status: 201, headers: { "x-restli-id": "urn:li:share:1" } });

    const result = await linkedinPublisher.publish({
      input: input({ platform: "linkedin", mediaUrls: [], media: [], accountRef: "urn:li:person:1" }),
      credentials: { token: "k" },
      fetchImpl: f.impl,
    });

    expect(result).toMatchObject({ status: "published", externalId: "urn:li:share:1" });
    expect(result.externalUrl).toContain("urn:li:share:1");
  });

  it("manda la version de la API en cada llamada", async () => {
    const f = fakeFetch({ status: 201, headers: {} });

    await linkedinPublisher.publish({
      input: input({ platform: "linkedin", mediaUrls: [], media: [], accountRef: "urn:li:person:1" }),
      credentials: { token: "k" },
      fetchImpl: f.impl,
    });

    const headers = f.calls[0].init?.headers as Record<string, string>;
    expect(headers["LinkedIn-Version"]).toMatch(/^\d{6}$/);
  });

  it("un 401 es permanente: hay que reconectar", async () => {
    const f = fakeFetch({ status: 401, text: "invalid token" });

    await expect(
      linkedinPublisher.publish({
        input: input({ platform: "linkedin", mediaUrls: [], media: [], accountRef: "urn:li:person:1" }),
        credentials: { token: "k" },
        fetchImpl: f.impl,
      }),
    ).rejects.toMatchObject({ kind: "permanent" });
  });

  it("con media avisa que todavia no se puede, en vez de publicar solo el texto", async () => {
    // Publicar el texto sin la imagen y no decir nada seria peor que fallar.
    await expect(
      linkedinPublisher.publish({
        input: input({ platform: "linkedin", accountRef: "urn:li:person:1" }),
        credentials: { token: "k" },
      }),
    ).rejects.toThrow(/solo publica texto/);
  });
});

// ── Threads ───────────────────────────────────────────────────────────────

describe("publicador de Threads (F34)", () => {
  it("crea el contenedor y despues publica: dos pasos", async () => {
    const f = fakeFetch({ body: { id: "cont-1" } }, { body: { id: "th-1" } });

    const result = await threadsPublisher.publish({
      input: input({ platform: "threads", accountRef: "9", mediaUrls: [], media: [] }),
      credentials: { token: "k" },
      fetchImpl: f.impl,
    });

    expect(result).toMatchObject({ status: "published", externalId: "th-1" });
    expect(f.calls[0].url).toContain("/threads?");
    expect(f.calls[1].url).toContain("threads_publish");
  });

  it("un hilo de 3 partes se publica en orden, cada una respondiendo a la anterior", async () => {
    // Sin reply_to_id serian tres posts sueltos y se leerian al reves.
    const f = fakeFetch(
      { body: { id: "c0" } }, { body: { id: "p0" } },
      { body: { id: "c1" } }, { body: { id: "p1" } },
      { body: { id: "c2" } }, { body: { id: "p2" } },
    );

    await threadsPublisher.publish({
      input: input({
        platform: "threads",
        accountRef: "9",
        mediaUrls: [],
        media: [],
        options: { threadItems: ["segunda", "tercera"] },
      }),
      credentials: { token: "k" },
      fetchImpl: f.impl,
    });

    expect(f.calls[2].url).toContain("reply_to_id=p0");
    expect(f.calls[4].url).toContain("reply_to_id=p1");
  });

  it("un video usa el tipo de contenedor que corresponde", async () => {
    const f = fakeFetch(
      { body: { id: "c" } },
      { body: { status: "FINISHED" } },
      { body: { id: "p" } },
    );

    await threadsPublisher.publish({
      input: input({ platform: "threads", accountRef: "9" }),
      credentials: { token: "k" },
      fetchImpl: f.impl,
    });

    expect(f.calls[0].url).toContain("media_type=VIDEO");
  });

  // ── A10 ────────────────────────────────────────────────────────────────

  it("A10 · el carrusel manda contenedores hijos y sus ids en children", async () => {
    // Sin `children` Meta rechaza el carrusel con 400 y no se publica nada.
    const f = fakeFetch(
      { body: { id: "hijo-1" } },
      { body: { id: "hijo-2" } },
      { body: { id: "cont" } },
      { body: { id: "th-1" } },
    );

    const result = await threadsPublisher.publish({
      input: input({
        platform: "threads",
        accountRef: "9",
        mediaUrls: ["https://s.test/1.jpg", "https://s.test/2.jpg"],
        media: [
          { storage_path: "a/1.jpg", mime_type: "image/jpeg", kind: "image", size_bytes: 1 },
          { storage_path: "a/2.jpg", mime_type: "image/jpeg", kind: "image", size_bytes: 1 },
        ],
      }),
      credentials: { token: "k" },
      fetchImpl: f.impl,
    });

    expect(f.calls[0].url).toContain("is_carousel_item=true");
    expect(f.calls[1].url).toContain("is_carousel_item=true");
    expect(f.calls[2].url).toContain("media_type=CAROUSEL");
    expect(decodeURIComponent(f.calls[2].url)).toContain("children=hijo-1,hijo-2");
    expect(result.status).toBe("published");
  });

  it("A10 · un video que sigue procesando queda en proceso, no se publica a medias", async () => {
    const slow = createThreadsPublisher({ sleep: async () => {} });
    const f = fakeFetch(
      { body: { id: "cont-v" } },
      ...Array.from({ length: CONTAINER_POLLS }, () => ({ body: { status: "IN_PROGRESS" } })),
    );

    const result = await slow.publish({
      input: input({ platform: "threads", accountRef: "9" }),
      credentials: { token: "k" },
      fetchImpl: f.impl,
    });

    expect(result.status).toBe("processing");
    expect(result.ref).toBe("cont-v");
    // El contenedor queda anotado: el reintento no vuelve a subir el video.
    expect(result.progress).toMatchObject({ containerId: "cont-v" });
  });

  it("A10 · un video que falla al procesarse es un fallo permanente", async () => {
    const slow = createThreadsPublisher({ sleep: async () => {} });
    const f = fakeFetch(
      { body: { id: "cont-v" } },
      { body: { status: "ERROR", error_message: "El video dura mas de 5 minutos" } },
    );

    await expect(
      slow.publish({
        input: input({ platform: "threads", accountRef: "9" }),
        credentials: { token: "k" },
        fetchImpl: f.impl,
      }),
    ).rejects.toThrow("El video dura mas de 5 minutos");
  });

  it("A10 · un hilo que fallo a la mitad NO republica el post principal", async () => {
    // Antes el reintento empezaba de cero y el principal quedaba dos veces.
    const f = fakeFetch({ body: { id: "c2" } }, { body: { id: "p2" } });

    const result = await threadsPublisher.publish({
      input: input({
        platform: "threads",
        accountRef: "9",
        mediaUrls: [],
        media: [],
        options: { threadItems: ["segunda", "tercera"] },
        progress: { rootId: "p0", lastId: "p1", parts: 1 },
      }),
      credentials: { token: "k" },
      fetchImpl: f.impl,
    });

    // Solo sale la tercera parte: dos llamadas, no seis.
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].url).toContain("reply_to_id=p1");
    expect(result.externalId).toBe("p0");
  });
});

// ── YouTube ───────────────────────────────────────────────────────────────

describe("subida a YouTube (F33)", () => {
  it("parte el archivo en trozos con su rango", () => {
    const ranges = chunkRanges(20, 8);

    expect(ranges).toEqual([
      { start: 0, end: 7, header: "bytes 0-7/20" },
      { start: 8, end: 15, header: "bytes 8-15/20" },
      { start: 16, end: 19, header: "bytes 16-19/20" },
    ]);
  });

  it("un archivo mas chico que una parte es una sola", () => {
    expect(chunkRanges(5, 8)).toHaveLength(1);
  });

  it("308 significa 'segui', no un error", () => {
    expect(isChunkAccepted(308)).toBe(true);
    expect(isChunkAccepted(200)).toBe(true);
    expect(isChunkAccepted(400)).toBe(false);
  });

  it("la cuota agotada es temporal: se renueva mañana", () => {
    expect(classifyYouTubeError(403, "quotaExceeded").kind).toBe("temporary");
    expect(classifyYouTubeError(403, "forbidden").kind).toBe("permanent");
  });

  it("sin visibilidad pedida, el video queda privado", () => {
    // Nunca se publica en publico por defecto.
    expect(metadataFrom(input({ options: {} })).privacyStatus).toBe("private");
    expect(metadataFrom(input({ options: { visibility: "unlisted" } })).privacyStatus).toBe("unlisted");
  });

  it("si se pidio publico y quedo privado, se avisa y se deshabilita el publicador", () => {
    // Es el sintoma exacto de un proyecto de Google sin auditar.
    const outcome = visibilityOutcome("public", "private");

    expect(outcome.ok).toBe(false);
    expect(outcome.disablePublisher).toBe(true);
    expect(outcome.warning).toContain("auditoria");
  });

  it("si quedo como se pidio, no hay nada que avisar", () => {
    expect(visibilityOutcome("unlisted", "unlisted")).toEqual({ ok: true });
  });

  it("sube por partes y no carga el archivo entero en memoria", async () => {
    // Un video de 800 MB en memoria en Railway es un proceso muerto.
    const leidos: Array<[number, number]> = [];
    const publisher = createYouTubePublisher({
      chunkBytes: 8,
      createReader: async () => ({
        sizeBytes: 20,
        contentType: "video/mp4",
        read: async (start, end) => {
          leidos.push([start, end]);
          return new ArrayBuffer(end - start + 1);
        },
      }),
    });

    const f = fakeFetch(
      { status: 200, headers: { location: "https://upload.test/session" } },
      { status: 308 },
      { status: 308 },
      { status: 200, body: { id: "yt-1" } },
      { status: 200, body: { items: [{ status: { privacyStatus: "unlisted" } }] } },
    );

    const result = await publisher.publish({
      input: input({ platform: "youtube", title: "Mi video", options: { visibility: "unlisted" } }),
      credentials: { token: "token" },
      fetchImpl: f.impl,
    });

    expect(result).toMatchObject({ status: "published", externalId: "yt-1" });
    expect(leidos).toHaveLength(3);
    expect(leidos.every(([start, end]) => end - start + 1 <= 8)).toBe(true);
  });

  it("si quedo privado sin pedirlo, la publicacion sale con la advertencia", async () => {
    const publisher = createYouTubePublisher({
      createReader: async () => ({
        sizeBytes: 4,
        contentType: "video/mp4",
        read: async () => new ArrayBuffer(4),
      }),
    });

    const f = fakeFetch(
      { status: 200, headers: { location: "https://upload.test/session" } },
      { status: 200, body: { id: "yt-1" } },
      { status: 200, body: { items: [{ status: { privacyStatus: "private" } }] } },
    );

    const result = await publisher.publish({
      input: input({ platform: "youtube", title: "t", options: { visibility: "public" } }),
      credentials: { token: "token" },
      fetchImpl: f.impl,
    });

    expect(result.status).toBe("published");
    expect(result.actualVisibility).toBe("private");
    expect(result.warning).toContain("privado");
  });
});
