/**
 * La media en Zernio (D5).
 *
 * Nuestros links firmados viven 24 horas. Un post agendado el martes que
 * sale el viernes los encontraria muertos, asi que el archivo tiene que
 * estar del lado de Zernio antes de agendar.
 */

import { describe, it, expect, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { PublishError } from "@/lib/jobs/errors";
import { ensureMediaInZernio } from "./zernio-media";
import type { MediaEntry } from "@/lib/content/media";

const WS = "ws-1";

const video: MediaEntry = {
  storage_path: `${WS}/p/video.mp4`,
  mime_type: "video/mp4",
  kind: "video",
  size_bytes: 1024,
};

function clientGiving(uploadUrl = "https://up.zernio.test/abc", publicUrl = "https://cdn.zernio.test/abc.mp4") {
  const getMediaPresignedUrl = vi.fn().mockResolvedValue({ data: { uploadUrl, publicUrl } });
  return { client: { media: { getMediaPresignedUrl } }, getMediaPresignedUrl };
}

function fetchOk(bytes = 4) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(bytes),
    _init: init,
  })) as unknown as typeof fetch;
}

const db = (cached: Array<Record<string, unknown>> = []): MemoryDb =>
  memoryDb({ provider_media: cached });

describe("D5 · subir la media a Zernio", () => {
  it("pide donde subir, sube y devuelve la direccion publica", async () => {
    const d = db();
    const { client, getMediaPresignedUrl } = clientGiving();
    const impl = fetchOk();

    const urls = await ensureMediaInZernio(d.client, {
      workspaceId: WS,
      client,
      media: [video],
      signedUrls: ["https://storage.test/firmada"],
      fetchImpl: impl,
    });

    expect(urls).toEqual(["https://cdn.zernio.test/abc.mp4"]);
    expect(getMediaPresignedUrl).toHaveBeenCalledWith({
      body: { filename: "video.mp4", contentType: "video/mp4", size: 1024 },
    });
    // Lee del bucket y hace PUT a Zernio: dos llamadas.
    expect((impl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });

  it("deja anotado que archivo es cual, para no subirlo dos veces", async () => {
    const d = db();
    const { client } = clientGiving();

    await ensureMediaInZernio(d.client, {
      workspaceId: WS,
      client,
      media: [video],
      signedUrls: ["https://storage.test/firmada"],
      fetchImpl: fetchOk(),
    });

    expect(d.rows("provider_media")[0]).toMatchObject({
      workspace_id: WS,
      publisher: "zernio",
      storage_path: video.storage_path,
      provider_url: "https://cdn.zernio.test/abc.mp4",
    });
  });

  it("la segunda vez usa la copia que ya esta, sin subir nada", async () => {
    // Programar tres redes con el mismo video no puede subirlo tres veces.
    const d = db([
      {
        workspace_id: WS,
        publisher: "zernio",
        storage_path: video.storage_path,
        size_bytes: 1024,
        provider_url: "https://cdn.zernio.test/ya-estaba.mp4",
      },
    ]);
    const { client, getMediaPresignedUrl } = clientGiving();
    const impl = fetchOk();

    const urls = await ensureMediaInZernio(d.client, {
      workspaceId: WS,
      client,
      media: [video],
      signedUrls: ["https://storage.test/firmada"],
      fetchImpl: impl,
    });

    expect(urls).toEqual(["https://cdn.zernio.test/ya-estaba.mp4"]);
    expect(getMediaPresignedUrl).not.toHaveBeenCalled();
  });

  it("si el archivo cambio de tamano, se vuelve a subir", async () => {
    const d = db([
      {
        workspace_id: WS,
        publisher: "zernio",
        storage_path: video.storage_path,
        size_bytes: 999,
        provider_url: "https://cdn.zernio.test/viejo.mp4",
      },
    ]);
    const { client, getMediaPresignedUrl } = clientGiving();

    const urls = await ensureMediaInZernio(d.client, {
      workspaceId: WS,
      client,
      media: [video],
      signedUrls: ["https://storage.test/firmada"],
      fetchImpl: fetchOk(),
    });

    expect(getMediaPresignedUrl).toHaveBeenCalledOnce();
    expect(urls).toEqual(["https://cdn.zernio.test/abc.mp4"]);
  });

  it("sin media no hace nada", async () => {
    const d = db();
    const { client, getMediaPresignedUrl } = clientGiving();

    expect(
      await ensureMediaInZernio(d.client, {
        workspaceId: WS,
        client,
        media: [],
        signedUrls: [],
        fetchImpl: fetchOk(),
      }),
    ).toEqual([]);
    expect(getMediaPresignedUrl).not.toHaveBeenCalled();
  });

  it("si Zernio rechaza la subida, no se agenda a medias", async () => {
    const d = db();
    const { client } = clientGiving();
    const impl = vi.fn(async (_url: unknown, init?: RequestInit) =>
      init?.method === "PUT"
        ? { ok: false, status: 507, arrayBuffer: async () => new ArrayBuffer(0) }
        : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) },
    ) as unknown as typeof fetch;

    await expect(
      ensureMediaInZernio(d.client, {
        workspaceId: WS,
        client,
        media: [video],
        signedUrls: ["https://storage.test/firmada"],
        fetchImpl: impl,
      }),
    ).rejects.toBeInstanceOf(PublishError);

    // Y no queda anotado que esta arriba cuando no esta.
    expect(d.rows("provider_media")).toHaveLength(0);
  });
});
