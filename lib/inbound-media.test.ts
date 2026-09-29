/**
 * Traer adentro la media del chat (F3).
 *
 * Lo que importa: que nunca lance (un adjunto que no se pudo bajar no puede
 * tumbar un webhook), que el tamano se corte antes de subir, que lo que no
 * tiene archivo no se intente bajar, y que el interruptor del workspace mande.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { emptyAttachment, type ChatAttachment } from "@/lib/messages/attachments";
import { chatMediaEnabled, downloadAttachments, storeInboundMedia, type MediaFetcher } from "./inbound-media";

const WS = "ws-1";
const CV = "cv-1";
const MSG = "m-1";

/** Base en memoria con el Storage simulado, que memoryDb no cubre. */
function db(options: { persist?: boolean; uploadError?: string | null } = {}) {
  const uploads: Array<{ path: string; bytes: number; contentType?: string }> = [];
  const removed: string[][] = [];
  const memory = memoryDb({
    workspaces: [{ id: WS, persist_chat_media: options.persist ?? true }],
    messages: [{ id: MSG, conversation_id: CV, workspace_id: WS, attachments: null }],
  });
  (memory.client as unknown as { storage: unknown }).storage = {
    from: () => ({
      upload: async (path: string, bytes: Uint8Array, opts?: { contentType?: string }) => {
        uploads.push({ path, bytes: bytes.byteLength, contentType: opts?.contentType });
        return options.uploadError ? { error: { message: options.uploadError } } : { error: null };
      },
      remove: async (paths: string[]) => {
        removed.push(paths);
        return { error: null };
      },
    }),
  };
  return { memory, uploads, removed };
}

/** Respuesta de fetch, con lo justo que usa el modulo. */
function response(options: {
  ok?: boolean;
  status?: number;
  bytes?: Uint8Array;
  contentType?: string;
  contentLength?: string;
}) {
  const bytes = options.bytes ?? new Uint8Array([1, 2, 3]);
  const headers = new Map<string, string>();
  if (options.contentType) headers.set("content-type", options.contentType);
  if (options.contentLength) headers.set("content-length", options.contentLength);
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: { get: (key: string) => headers.get(key.toLowerCase()) ?? null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

const pendingImage = (over: Partial<ChatAttachment> = {}) =>
  emptyAttachment("image", { sourceUrl: "https://cdn.meta/x.jpg", status: "pending", ...over });

const attachmentsOf = (memory: ReturnType<typeof memoryDb>) =>
  (memory.rows("messages")[0].attachments as { v: number; items: ChatAttachment[] } | null);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("storeInboundMedia: el camino feliz (F3)", () => {
  it("baja el archivo, lo sube al bucket y deja el item listo con su path", async () => {
    const { memory, uploads } = db();
    const fetchImpl = vi.fn(async () => response({ contentType: "image/jpeg", bytes: new Uint8Array(1024) }));

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [pendingImage()],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.stored).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.items[0]).toMatchObject({
      kind: "image",
      status: "ready",
      storagePath: `${WS}/${CV}/${MSG}-0.jpg`,
      mime: "image/jpeg",
      sizeBytes: 1024,
      error: null,
    });
    // El path arranca con el workspace, que es lo que lee la policy.
    expect(uploads[0]).toMatchObject({ path: `${WS}/${CV}/${MSG}-0.jpg`, contentType: "image/jpeg" });
    // Se conserva la URL del proveedor como respaldo.
    expect(result.items[0].sourceUrl).toBe("https://cdn.meta/x.jpg");
  });

  it("escribe la columna una sola vez, con la forma nueva", async () => {
    const { memory } = db();
    const fetchImpl = vi.fn(async () => response({ contentType: "audio/ogg" }));

    await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [emptyAttachment("voice", { sourceUrl: "https://cdn/a.ogg", status: "pending", durationSeconds: 8 })],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const column = attachmentsOf(memory);
    expect(column?.v).toBe(2);
    expect(column?.items[0]).toMatchObject({ kind: "voice", status: "ready", durationSeconds: 8 });
  });

  it("el Content-Type del proveedor gana sobre el mime declarado", async () => {
    const { memory, uploads } = db();
    const fetchImpl = vi.fn(async () => response({ contentType: "audio/mp4" }));

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      // WhatsApp e Instagram mandan tipos inventados; el que sirve es el real.
      items: [emptyAttachment("audio", { sourceUrl: "https://cdn/a", mime: "audio/loquesea", status: "pending" })],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.items[0].mime).toBe("audio/mp4");
    expect(uploads[0].path).toMatch(/\.m4a$/);
  });

  it("varios adjuntos del mismo mensaje no se pisan", async () => {
    const { memory, uploads } = db();
    const fetchImpl = vi.fn(async () => response({ contentType: "image/jpeg" }));

    await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [pendingImage(), pendingImage({ sourceUrl: "https://cdn.meta/y.jpg" })],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(uploads.map((u) => u.path)).toEqual([`${WS}/${CV}/${MSG}-0.jpg`, `${WS}/${CV}/${MSG}-1.jpg`]);
  });
});

describe("storeInboundMedia: lo que sale mal (F3)", () => {
  it("si el proveedor responde mal, el item queda failed con el motivo y NO lanza", async () => {
    const { memory } = db();
    const fetchImpl = vi.fn(async () => response({ ok: false, status: 404 }));

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [pendingImage()],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.failed).toBe(1);
    expect(result.items[0]).toMatchObject({ status: "failed", storagePath: null });
    expect(result.items[0].error).toContain("404");
    // La URL se conserva: es lo unico con lo que se puede reintentar.
    expect(result.items[0].sourceUrl).toBe("https://cdn.meta/x.jpg");
  });

  it("si la red se cae, tampoco lanza", async () => {
    const { memory } = db();
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [pendingImage()],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.items[0].status).toBe("failed");
    expect(result.items[0].error).toContain("Reintentar");
  });

  it("un archivo de mas de 25 MB se marca failed SIN subirlo", async () => {
    const { memory, uploads } = db();
    const fetchImpl = vi.fn(async () => response({ contentLength: String(30 * 1024 * 1024) }));

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [pendingImage()],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.items[0]).toMatchObject({ status: "failed", error: "El archivo supera el máximo de 25 MB" });
    expect(uploads).toHaveLength(0);
    // Ni se leyo el cuerpo: el largo declarado alcanzo para descartarlo.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uno grande que no declara su largo tambien se corta, ya leido", async () => {
    const { memory, uploads } = db();
    const fetchImpl = vi.fn(async () => response({ bytes: new Uint8Array(200) }));

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [pendingImage()],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxBytes: 100,
    });

    expect(result.items[0].status).toBe("failed");
    expect(uploads).toHaveLength(0);
  });

  it("un archivo vacio no se sube: seria un reproductor roto", async () => {
    const { memory, uploads } = db();
    const fetchImpl = vi.fn(async () => response({ bytes: new Uint8Array(0) }));

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [pendingImage()],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.items[0]).toMatchObject({ status: "failed", error: "El archivo llegó vacío" });
    expect(uploads).toHaveLength(0);
  });

  it("si Storage rechaza la subida, queda failed y se puede reintentar", async () => {
    const { memory } = db({ uploadError: "mime type not supported" });
    const fetchImpl = vi.fn(async () => response({ contentType: "image/jpeg" }));

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [pendingImage()],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.items[0]).toMatchObject({ status: "failed" });
    expect(result.items[0].error).toContain("Reintentar");
  });

  it("un adjunto sin direccion de descarga se marca, no se cuelga", async () => {
    const { memory } = db();

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [emptyAttachment("image", { status: "pending" })],
      fetchImpl: (async () => response({})) as unknown as typeof fetch,
    });

    expect(result.items[0].status).toBe("failed");
  });

  it("un adjunto que falla no impide que el otro se guarde", async () => {
    const { memory } = db();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      return call === 1 ? response({ ok: false, status: 500 }) : response({ contentType: "image/jpeg" });
    });

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [pendingImage(), pendingImage({ sourceUrl: "https://cdn.meta/y.jpg" })],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.stored).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.items.map((i) => i.status)).toEqual(["failed", "ready"]);
  });
});

describe("lo que NO se intenta bajar (F4)", () => {
  it("una ubicacion, un contacto y una encuesta no tienen archivo: se dejan como estan", async () => {
    const { memory, uploads } = db();
    const fetchImpl = vi.fn(async () => response({}));

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [emptyAttachment("location"), emptyAttachment("contact"), emptyAttachment("poll")],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
    expect(result.items.map((i) => i.status)).toEqual(["none", "none", "none"]);
  });

  it("un post compartido es un link, no un archivo", async () => {
    const { memory } = db();
    const fetchImpl = vi.fn(async () => response({}));

    await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [emptyAttachment("share", { meta: { url: "https://instagram.com/p/abc" } })],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uno que ya esta listo no se vuelve a bajar", async () => {
    const { memory } = db();
    const fetchImpl = vi.fn(async () => response({}));

    await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [emptyAttachment("image", { status: "ready", storagePath: "ws-1/cv-1/ya.jpg" })],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sin adjuntos no toca la base", async () => {
    const { memory } = db();
    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [],
    });

    expect(result).toEqual({ items: [], stored: 0, failed: 0 });
    expect(attachmentsOf(memory)).toBeNull();
  });
});

describe("el interruptor del workspace (F2)", () => {
  it("apagado, no baja nada y el item queda sin archivo pero sin error", async () => {
    const { memory, uploads } = db({ persist: false });
    const fetchImpl = vi.fn(async () => response({}));

    const result = await storeInboundMedia({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [pendingImage()],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
    // "none" y no "failed": no fallo nada, simplemente no se guarda.
    expect(result.items[0]).toMatchObject({ status: "none", error: null });
    // Los metadatos igual se guardan: la burbuja tiene que decir que llego algo.
    expect(attachmentsOf(memory)?.items[0].kind).toBe("image");
  });

  it("prendido es el default cuando la columna no dice nada", async () => {
    const memory = memoryDb({ workspaces: [{ id: WS, persist_chat_media: null }] });
    await expect(chatMediaEnabled(memory.client, WS)).resolves.toBe(true);
  });

  it("un workspace que no aparece usa el default (prendido): no es un error de lectura", async () => {
    const memory = memoryDb({ workspaces: [] });
    await expect(chatMediaEnabled(memory.client, "ws-inexistente")).resolves.toBe(true);
  });

  it("si la consulta FALLA no se baja: bajar sin permiso es peor que no bajar", async () => {
    // memoryDb no simula errores, asi que el cliente se arma a mano.
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "timeout" } }) }),
        }),
      }),
    } as unknown as Parameters<typeof chatMediaEnabled>[0];

    await expect(chatMediaEnabled(broken, WS)).resolves.toBe(false);
  });
});

describe("downloadAttachments: la parte de red, sin base", () => {
  it("un fetcher que devuelve bytes sube sin pasar por fetch (es el camino de WhatsApp)", async () => {
    const { memory, uploads } = db();
    const fetchImpl = vi.fn(async () => response({}));
    const fetcher: MediaFetcher = async () => ({
      kind: "bytes",
      bytes: new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
      mime: "audio/ogg; codecs=opus",
    });

    const result = await downloadAttachments({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [emptyAttachment("voice", { status: "pending" })],
      fetcher,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({ status: "ready", mime: "audio/ogg" });
    expect(uploads[0].path).toMatch(/\.ogg$/);
  });

  it("un fetcher que devuelve error marca el item con ese motivo", async () => {
    const { memory } = db();
    const fetcher: MediaFetcher = async () => ({ kind: "error", message: "Evolution no devolvió el archivo" });

    const result = await downloadAttachments({
      supabase: memory.client,
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      items: [emptyAttachment("voice", { status: "pending" })],
      fetcher,
    });

    expect(result.items[0]).toMatchObject({ status: "failed", error: "Evolution no devolvió el archivo" });
  });
});
