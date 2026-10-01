/**
 * Fotos de perfil estables (F16).
 */

import { describe, it, expect, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { shouldRefreshAvatar, storeContactAvatar, maybeStoreContactAvatar, AVATAR_REFRESH_DAYS } from "./avatar";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

describe("shouldRefreshAvatar", () => {
  it("una foto manual nunca se refresca", () => {
    expect(
      shouldRefreshAvatar({ avatarUrl: "https://x", avatarSource: "manual", avatarUpdatedAt: null }, NOW),
    ).toBe(false);
  });

  it("sin foto, siempre hay que traerla", () => {
    expect(shouldRefreshAvatar({ avatarUrl: null, avatarSource: null, avatarUpdatedAt: null }, NOW)).toBe(true);
  });

  it("una foto external siempre se copia: es la que find_or_link_contact ya refresco en la base", () => {
    expect(
      shouldRefreshAvatar({ avatarUrl: "https://cdn.meta/x.jpg", avatarSource: "external", avatarUpdatedAt: null }, NOW),
    ).toBe(true);
  });

  it("una foto storage reciente no se toca", () => {
    expect(
      shouldRefreshAvatar({ avatarUrl: "https://x", avatarSource: "storage", avatarUpdatedAt: daysAgo(5) }, NOW),
    ).toBe(false);
  });

  it(`una foto storage de mas de ${AVATAR_REFRESH_DAYS} dias se refresca`, () => {
    expect(
      shouldRefreshAvatar({ avatarUrl: "https://x", avatarSource: "storage", avatarUpdatedAt: daysAgo(31) }, NOW),
    ).toBe(true);
  });

  it("justo en el limite de 30 dias todavia no", () => {
    expect(
      shouldRefreshAvatar({ avatarUrl: "https://x", avatarSource: "storage", avatarUpdatedAt: daysAgo(30) }, NOW),
    ).toBe(false);
  });

  it("una fecha ilegible fuerza el refresco en vez de quedar pegada", () => {
    expect(
      shouldRefreshAvatar({ avatarUrl: "https://x", avatarSource: "storage", avatarUpdatedAt: "cualquier cosa" }, NOW),
    ).toBe(true);
  });
});

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);

function db() {
  const memory = memoryDb({ contacts: [{ id: "c-1", workspace_id: "ws-1", avatar_source: "external" }] });
  const uploads: Array<{ path: string; contentType?: string }> = [];
  (memory.client as unknown as { storage: unknown }).storage = {
    from: () => ({
      upload: async (path: string, _bytes: Uint8Array, opts?: { contentType?: string }) => {
        uploads.push({ path, contentType: opts?.contentType });
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/avatars/${path}` } }),
    }),
  };
  return { memory, uploads };
}

const row = (memory: ReturnType<typeof memoryDb>) => memory.rows("contacts")[0];

describe("storeContactAvatar", () => {
  it("descarga, sube a avatars/<ws>/contacts/<id>.jpg y deja la URL con cache-buster", async () => {
    const { memory, uploads } = db();
    const fetchImpl = async () => new Response(JPEG_BYTES, { status: 200 });

    const result = await storeContactAvatar({
      supabase: memory.client,
      workspaceId: "ws-1",
      contactId: "c-1",
      sourceUrl: "https://cdn.meta/foto.jpg",
      now: NOW,
      fetchImpl,
    });

    expect(result).toEqual({ ok: true });
    expect(uploads[0].path).toBe("ws-1/contacts/c-1.jpg");
    expect(uploads[0].contentType).toBe("image/jpeg");
    expect(row(memory)).toMatchObject({
      avatar_source: "storage",
      avatar_updated_at: NOW.toISOString(),
    });
    expect(row(memory).avatar_url).toBe(`https://storage.test/avatars/ws-1/contacts/c-1.jpg?v=${NOW.getTime()}`);
  });

  it("un 404 del proveedor no lanza: deja el contacto como estaba", async () => {
    const { memory } = db();
    const fetchImpl = async () => new Response(null, { status: 404 });

    const result = await storeContactAvatar({
      supabase: memory.client,
      workspaceId: "ws-1",
      contactId: "c-1",
      sourceUrl: "https://cdn.meta/foto.jpg",
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(row(memory).avatar_source).toBe("external");
  });

  it("un archivo que no es jpeg/png/webp se rechaza sin subirlo", async () => {
    const { memory, uploads } = db();
    const fetchImpl = async () => new Response(new Uint8Array(20).fill(0), { status: 200 });

    const result = await storeContactAvatar({
      supabase: memory.client,
      workspaceId: "ws-1",
      contactId: "c-1",
      sourceUrl: "https://cdn.meta/foto.bin",
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("jpeg, png o webp") });
    expect(uploads).toHaveLength(0);
  });

  it("mas de 2 MB se rechaza sin descargar entero innecesariamente pesado", async () => {
    const { memory } = db();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(JPEG_BYTES);
    const fetchImpl = async () => new Response(big, { status: 200 });

    const result = await storeContactAvatar({
      supabase: memory.client,
      workspaceId: "ws-1",
      contactId: "c-1",
      sourceUrl: "https://cdn.meta/foto.jpg",
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("2 MB") });
  });

  it("una excepcion de red no lanza", async () => {
    const { memory } = db();
    const fetchImpl = async () => {
      throw new Error("network down");
    };

    const result = await storeContactAvatar({
      supabase: memory.client,
      workspaceId: "ws-1",
      contactId: "c-1",
      sourceUrl: "https://cdn.meta/foto.jpg",
      fetchImpl,
    });

    expect(result).toEqual({ ok: false, reason: "network down" });
  });
});

describe("maybeStoreContactAvatar", () => {
  it("un contacto external la copia, y resuelve la URL de forma perezosa", async () => {
    const { memory, uploads } = db();
    const fetchImpl = async () => new Response(JPEG_BYTES, { status: 200 });
    const resolveSourceUrl = vi.fn(() => "https://cdn.meta/foto.jpg");

    await maybeStoreContactAvatar({
      supabase: memory.client,
      workspaceId: "ws-1",
      contactId: "c-1",
      resolveSourceUrl,
      now: NOW,
      fetchImpl,
    });

    expect(resolveSourceUrl).toHaveBeenCalledTimes(1);
    expect(uploads).toHaveLength(1);
    expect(row(memory).avatar_source).toBe("storage");
  });

  it("un contacto manual no se toca, ni se resuelve la URL ni se descarga nada", async () => {
    const { memory, uploads } = db();
    row(memory).avatar_source = "manual";
    row(memory).avatar_url = "https://cdn/puesta-a-mano.jpg";
    const resolveSourceUrl = vi.fn(() => "https://cdn.meta/foto.jpg");

    await maybeStoreContactAvatar({
      supabase: memory.client,
      workspaceId: "ws-1",
      contactId: "c-1",
      resolveSourceUrl,
    });

    // Esto es lo que importa para WhatsApp: ni siquiera se le pregunta a
    // Evolution por la foto (fetchProfilePictureUrl) si no hace falta.
    expect(resolveSourceUrl).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
    expect(row(memory).avatar_url).toBe("https://cdn/puesta-a-mano.jpg");
  });

  it("un contacto storage reciente no se vuelve a copiar, ni se resuelve la URL", async () => {
    const { memory, uploads } = db();
    row(memory).avatar_source = "storage";
    row(memory).avatar_url = "https://storage.test/x.jpg";
    row(memory).avatar_updated_at = daysAgo(2);
    const resolveSourceUrl = vi.fn(() => "https://cdn.meta/foto.jpg");

    await maybeStoreContactAvatar({
      supabase: memory.client,
      workspaceId: "ws-1",
      contactId: "c-1",
      resolveSourceUrl,
      now: NOW,
    });

    expect(resolveSourceUrl).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
  });

  it("si resolveSourceUrl devuelve null (el proveedor no tiene la foto), no hace nada", async () => {
    const { memory, uploads } = db();
    await maybeStoreContactAvatar({
      supabase: memory.client,
      workspaceId: "ws-1",
      contactId: "c-1",
      resolveSourceUrl: () => null,
    });
    expect(uploads).toHaveLength(0);
  });

  it("nunca lanza, ni si falla la consulta del contacto", async () => {
    const memory = memoryDb({ contacts: [] });
    await expect(
      maybeStoreContactAvatar({
        supabase: memory.client,
        workspaceId: "ws-1",
        contactId: "no-existe",
        resolveSourceUrl: () => "https://x",
      }),
    ).resolves.toBeUndefined();
  });

  it("nunca lanza, ni si resolveSourceUrl explota (fetchProfilePictureUrl puede tirar EvolutionError)", async () => {
    const { memory } = db();
    await expect(
      maybeStoreContactAvatar({
        supabase: memory.client,
        workspaceId: "ws-1",
        contactId: "c-1",
        resolveSourceUrl: () => {
          throw new Error("Evolution API respondio 500");
        },
      }),
    ).resolves.toBeUndefined();
  });
});
