/**
 * Subida directa de audio/archivos al chat (F19).
 *
 * Lo que importa: que la RLS decida (se lee con el cliente del usuario), que
 * `chat-media` se firme con el SERVICE ROLE (el bucket no tiene policies de
 * escritura), que el tipo salga de los bytes y no de lo que declara el
 * navegador, y que un audio grabado quede como "voice" mientras uno
 * adjuntado del disco queda como "audio".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClient, createServiceClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient, createServiceClient }));

import { requestChatUpload } from "./chat-upload";
import { MAX_CHAT_UPLOAD_BYTES } from "@/lib/chat-media/bucket";

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
const M4A_HEAD = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]).toString("base64");

function setup(options: { user?: boolean; conversation?: Record<string, unknown> | null; signError?: boolean } = {}) {
  const createSignedUploadUrl = vi.fn(async () => ({ data: { token: "tok-1" }, error: null }));
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: "u-1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: options.conversation ?? null, error: null }) }),
      }),
    }),
  });
  createServiceClient.mockResolvedValue({
    storage: {
      from: () => ({
        createSignedUploadUrl: options.signError
          ? async () => ({ data: null, error: { message: "boom" } })
          : createSignedUploadUrl,
      }),
    },
  });
  return { createSignedUploadUrl };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("requestChatUpload (F19)", () => {
  it("sin sesion, 'No autorizado'", async () => {
    setup({ user: false });
    const result = await requestChatUpload({ conversationId: "cv-1", sizeBytes: 100, headBase64: JPEG_HEAD });
    expect(result).toEqual({ ok: false, error: "No autorizado" });
  });

  it("si la RLS no deja ver la conversacion, no se firma nada", async () => {
    const { createSignedUploadUrl } = setup({ conversation: null });
    const result = await requestChatUpload({ conversationId: "cv-1", sizeBytes: 100, headBase64: JPEG_HEAD });
    expect(result).toEqual({ ok: false, error: "No encontré esa conversación" });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("una imagen adjuntada del disco: kind 'image', path con el workspace y la conversacion", async () => {
    setup({ conversation: { id: "cv-1", workspace_id: "ws-1" } });
    const result = await requestChatUpload({ conversationId: "cv-1", sizeBytes: 1000, headBase64: JPEG_HEAD });

    expect(result).toMatchObject({ ok: true, mime: "image/jpeg", kind: "image", token: "tok-1" });
    if (result.ok) {
      expect(result.path).toMatch(/^ws-1\/cv-1\/out-[0-9a-f-]+\.jpg$/);
    }
  });

  it("un audio GRABADO queda como voice; el mismo audio ADJUNTADO del disco queda como audio", async () => {
    setup({ conversation: { id: "cv-1", workspace_id: "ws-1" } });

    const recorded = await requestChatUpload({
      conversationId: "cv-1",
      sizeBytes: 1000,
      headBase64: M4A_HEAD,
      isRecording: true,
    });
    expect(recorded).toMatchObject({ kind: "voice" });

    const attached = await requestChatUpload({ conversationId: "cv-1", sizeBytes: 1000, headBase64: M4A_HEAD });
    expect(attached).toMatchObject({ kind: "audio" });
  });

  it("una grabacion del navegador (MP4 con marca isom) queda como voz, no como video", async () => {
    setup({ conversation: { id: "cv-1", workspace_id: "ws-1" } });
    // Lo que graba Chrome/Safari: `ftyp` con marca generica, no `M4A `.
    const isomHead = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).toString("base64");

    const recorded = await requestChatUpload({
      conversationId: "cv-1",
      sizeBytes: 56_000,
      headBase64: isomHead,
      declaredMime: "audio/mp4",
      isRecording: true,
    });

    expect(recorded).toMatchObject({ ok: true, kind: "voice", mime: "audio/mp4" });
  });

  it("mas de 16 MB se rechaza sin firmar", async () => {
    const { createSignedUploadUrl } = setup({ conversation: { id: "cv-1", workspace_id: "ws-1" } });
    const result = await requestChatUpload({
      conversationId: "cv-1",
      sizeBytes: MAX_CHAT_UPLOAD_BYTES + 1,
      headBase64: JPEG_HEAD,
    });
    expect(result.ok).toBe(false);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("un archivo vacio se rechaza", async () => {
    setup({ conversation: { id: "cv-1", workspace_id: "ws-1" } });
    const result = await requestChatUpload({ conversationId: "cv-1", sizeBytes: 0, headBase64: JPEG_HEAD });
    expect(result).toEqual({ ok: false, error: "El archivo está vacío" });
  });

  it("un tipo no reconocido se rechaza, con el mime declarado en el mensaje", async () => {
    setup({ conversation: { id: "cv-1", workspace_id: "ws-1" } });
    const basura = Buffer.from(new Uint8Array(16)).toString("base64");
    const result = await requestChatUpload({
      conversationId: "cv-1",
      sizeBytes: 100,
      headBase64: basura,
      declaredMime: "application/x-weird",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("application/x-weird");
  });

  it("si Storage no puede firmar, no lanza: devuelve el error", async () => {
    setup({ conversation: { id: "cv-1", workspace_id: "ws-1" }, signError: true });
    const result = await requestChatUpload({ conversationId: "cv-1", sizeBytes: 1000, headBase64: JPEG_HEAD });
    expect(result).toEqual({ ok: false, error: "No pude preparar la subida" });
  });
});
