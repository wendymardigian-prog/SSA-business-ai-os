/**
 * Zernio agenda de su lado (D1 a D4, D7).
 *
 * El SDK simulado siempre: ninguna llamada real, ninguna cuenta conectada,
 * nada publicado.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublishError } from "@/lib/jobs/errors";
import type { PublishInput } from "./types";

const { createZernioClient } = vi.hoisted(() => ({ createZernioClient: vi.fn() }));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient }));

const { zernioScheduler } = await import("./zernio");

const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  platform: "instagram",
  text: "Un caption",
  media: [{ storage_path: "ws/p/v.mp4", mime_type: "video/mp4", kind: "video", size_bytes: 100 }],
  mediaUrls: ["https://cdn.zernio.test/v.mp4"],
  options: {},
  accountRef: "ig-acc",
  ...over,
});

const request = (over: Record<string, unknown> = {}) => ({
  input: input(),
  credentials: { token: "k" },
  at: "2026-10-01T18:00:00.000Z",
  timezone: "America/Costa_Rica",
  requestId: "sp-1:1",
  ...over,
});

function clientWith(posts: Record<string, unknown>) {
  createZernioClient.mockReturnValue({ posts });
  return posts;
}

const apiError = (statusCode: number, message: string, details?: object) =>
  Object.assign(new Error(message), { statusCode, details });

beforeEach(() => createZernioClient.mockReset());

describe("D1 · programar es crear el post con su fecha", () => {
  it("manda scheduledFor y la zona del workspace, y guarda el id", async () => {
    const createPost = vi.fn().mockResolvedValue({ data: { post: { _id: "zp-1" } } });
    clientWith({ createPost });

    const result = await zernioScheduler.create(request() as never);

    expect(result).toEqual({ ref: "zp-1" });
    const body = createPost.mock.calls[0][0].body;
    expect(body.scheduledFor).toBe("2026-10-01T18:00:00.000Z");
    expect(body.timezone).toBe("America/Costa_Rica");
    expect(body.publishNow).toBeUndefined();
    // Un post de Zernio POR RED: asi un fallo de TikTok no arrastra a
    // Instagram.
    expect(body.platforms).toHaveLength(1);
    expect(body.platforms[0]).toMatchObject({ platform: "instagram", accountId: "ig-acc" });
  });

  it("D7 · manda el id de pedido para que un corte de red no duplique", async () => {
    const createPost = vi.fn().mockResolvedValue({ data: { post: { _id: "zp-1" } } });
    clientWith({ createPost });

    await zernioScheduler.create(request() as never);

    expect(createPost.mock.calls[0][0].headers).toEqual({ "x-request-id": "sp-1:1" });
  });

  it("si Zernio contesta que ese post ya existe, se usa ese: no es un fallo", async () => {
    // Su dedupe por contenido rechaza con 409 y devuelve el id del que ya
    // habia. Tratarlo como error dejaria la pieza sin referencia.
    const createPost = vi.fn().mockRejectedValue(
      apiError(409, "duplicado", { existingPostId: "zp-viejo" }),
    );
    clientWith({ createPost });

    expect(await zernioScheduler.create(request() as never)).toEqual({ ref: "zp-viejo" });
  });

  it("un 429 queda temporal para que se reintente", async () => {
    clientWith({ createPost: vi.fn().mockRejectedValue(apiError(429, "Demasiados pedidos")) });

    await expect(zernioScheduler.create(request() as never)).rejects.toMatchObject({
      kind: "temporary",
    });
  });

  it("un 422 queda permanente: reintentarlo lo rechaza igual", async () => {
    clientWith({ createPost: vi.fn().mockRejectedValue(apiError(422, "El caption es muy largo")) });

    await expect(zernioScheduler.create(request() as never)).rejects.toMatchObject({
      kind: "permanent",
    });
  });

  it("sin id de post no se da por agendado", async () => {
    clientWith({ createPost: vi.fn().mockResolvedValue({ data: { post: {} } }) });

    await expect(zernioScheduler.create(request() as never)).rejects.toBeInstanceOf(PublishError);
  });
});

describe("D2 · publicar ahora", () => {
  it("manda publishNow en vez de la fecha", async () => {
    const createPost = vi.fn().mockResolvedValue({ data: { post: { _id: "zp-1" } } });
    clientWith({ createPost });

    await zernioScheduler.create(request({ now: true }) as never);

    const body = createPost.mock.calls[0][0].body;
    expect(body.publishNow).toBe(true);
    expect(body.scheduledFor).toBeUndefined();
  });
});

describe("D3 · reprogramar y editar", () => {
  it("usa updatePost con la fecha nueva", async () => {
    const updatePost = vi.fn().mockResolvedValue({ data: {} });
    clientWith({ updatePost });

    await zernioScheduler.update({ ...request({ at: "2026-10-05T18:00:00.000Z" }), ref: "zp-1" } as never);

    const call = updatePost.mock.calls[0][0];
    expect(call.path).toEqual({ postId: "zp-1" });
    expect(call.body.scheduledFor).toBe("2026-10-05T18:00:00.000Z");
    // Sin isDraft:false, Zernio contesta 200 y el post sigue siendo borrador.
    expect(call.body.isDraft).toBe(false);
  });

  it("si Zernio lo rechaza, el motivo llega tal cual", async () => {
    clientWith({
      updatePost: vi.fn().mockRejectedValue(apiError(422, "Falta muy poco para la publicacion")),
    });

    await expect(
      zernioScheduler.update({ ...request(), ref: "zp-1" } as never),
    ).rejects.toThrow("Falta muy poco para la publicacion");
  });
});

describe("D4 · desprogramar y reintentar", () => {
  it("desprogramar borra el post en Zernio", async () => {
    const deletePost = vi.fn().mockResolvedValue({ data: {} });
    clientWith({ deletePost });

    await zernioScheduler.cancel({ ref: "zp-1", credentials: { token: "k" } });

    expect(deletePost).toHaveBeenCalledWith({ path: { postId: "zp-1" } });
  });

  it("si ya no existe, el objetivo esta cumplido", async () => {
    clientWith({ deletePost: vi.fn().mockRejectedValue(apiError(404, "no existe")) });

    await expect(
      zernioScheduler.cancel({ ref: "zp-1", credentials: { token: "k" } }),
    ).resolves.toBeUndefined();
  });

  it("reintentar usa retryPost", async () => {
    const retryPost = vi.fn().mockResolvedValue({ data: {} });
    clientWith({ retryPost });

    await zernioScheduler.retry({ ref: "zp-1", credentials: { token: "k" } });

    expect(retryPost).toHaveBeenCalledWith({ path: { postId: "zp-1" } });
  });
});
