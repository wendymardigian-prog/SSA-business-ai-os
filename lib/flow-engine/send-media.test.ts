/**
 * sendChannelMessage con media (F19): el unico lugar donde se envia un
 * archivo, por los dos canales.
 *
 * Lo que mas importa, en orden:
 *   1. El envio de TEXTO SIN MEDIA sigue funcionando exactamente igual
 *      (no-regresion): es lo primero que se prueba, antes de tocar nada.
 *   2. Audio por WhatsApp: sendWhatsAppAudio, con una URL FIRMADA del bucket.
 *   3. Audio por Instagram: se sube a Zernio con uploadMediaDirect, y se usa
 *      ESA url (nunca una firmada de Supabase).
 *   4. Un ogg/opus/webm se rechaza para Instagram ANTES de subir nada.
 *   5. El bug arreglado: un flow con mediaUrl por Evolution ahora SI se
 *      manda (antes se descartaba en silencio).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { sendText, sendWhatsAppAudio, sendMedia, getEvolutionConfig, sendInboxMessage, uploadMediaDirect } = vi.hoisted(
  () => ({
    sendText: vi.fn(async () => ({ id: "wa-text-1" })),
    sendWhatsAppAudio: vi.fn(async () => ({ id: "wa-audio-1" })),
    sendMedia: vi.fn(async () => ({ id: "wa-media-1" })),
    getEvolutionConfig: vi.fn(async () => ({ baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" })),
    sendInboxMessage: vi.fn(async () => ({ data: { data: { messageId: "ig-1" } } })),
    uploadMediaDirect: vi.fn(async () => ({ data: { url: "https://cdn.zernio.test/u/audio.m4a" } })),
  }),
);

vi.mock("@/lib/evolution-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/evolution-client")>();
  return { ...actual, sendText, sendWhatsAppAudio, sendMedia };
});
vi.mock("@/lib/evolution-config", () => ({ getEvolutionConfig }));

const zernioClient = { messages: { sendInboxMessage, uploadMediaDirect } };
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: () => zernioClient }));
vi.mock("@/lib/integrations/zernio-key", () => ({ getZernioApiKey: async () => "api-key-1" }));

import { sendChannelMessage, type SendContext } from "./send";

const WS = "ws-1";

function db(overrides: Parameters<typeof memoryDb>[0] = {}) {
  const downloads: string[] = [];
  const signedUrls: string[] = [];
  const memory = memoryDb({
    channels: [
      { id: "ch-wa", workspace_id: WS, provider: "evolution", platform: "whatsapp", evolution_instance: "ssa-1", is_active: true },
      { id: "ch-ig", workspace_id: WS, provider: "late", platform: "instagram", late_account_id: "acc-1", is_active: true },
    ],
    contact_channels: [
      { channel_id: "ch-wa", contact_id: "c-1", platform_sender_id: "5491122334455" },
      { channel_id: "ch-ig", contact_id: "c-1", platform_sender_id: "ig-sender-1" },
    ],
    conversations: [{ id: "cv-1", late_conversation_id: "late-cv-1" }],
    ...overrides,
  }, {
    rpc: { claim_automated_send: () => true },
  });

  const fakeFile = new Uint8Array([0xff, 0xd8, 0xff]);
  (memory.client as unknown as { storage: unknown }).storage = {
    from: () => ({
      download: async (path: string) => {
        downloads.push(path);
        return { data: new Blob([fakeFile]), error: null };
      },
      createSignedUrl: async (path: string) => {
        signedUrls.push(path);
        return { data: { signedUrl: `https://signed.test/${path}` }, error: null };
      },
    }),
  };

  return { memory, downloads, signedUrls };
}

const waContext: SendContext = { workspaceId: WS, channelId: "ch-wa", contactId: "c-1", conversationId: "cv-1" };
const igContext: SendContext = { workspaceId: WS, channelId: "ch-ig", contactId: "c-1", conversationId: "cv-1" };

beforeEach(() => {
  vi.clearAllMocks();
  sendText.mockResolvedValue({ id: "wa-text-1" });
  sendWhatsAppAudio.mockResolvedValue({ id: "wa-audio-1" });
  sendMedia.mockResolvedValue({ id: "wa-media-1" });
  sendInboxMessage.mockResolvedValue({ data: { data: { messageId: "ig-1" } } });
  uploadMediaDirect.mockResolvedValue({ data: { url: "https://cdn.zernio.test/u/audio.m4a" } });
  getEvolutionConfig.mockResolvedValue({ baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" });
});

describe("texto sin media (no-regresion)", () => {
  it("WhatsApp: sigue mandando con sendText, sin tocar sendMedia ni sendWhatsAppAudio", async () => {
    const { memory } = db();
    const outcome = await sendChannelMessage(memory.client, waContext, { text: "hola" });

    expect(outcome.ok).toBe(true);
    expect(sendText).toHaveBeenCalledWith(expect.anything(), "ssa-1", "5491122334455", "hola");
    expect(sendWhatsAppAudio).not.toHaveBeenCalled();
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("Instagram: sigue mandando con sendInboxMessage sin attachmentUrl", async () => {
    const { memory } = db();
    const outcome = await sendChannelMessage(memory.client, igContext, { text: "hola" });

    expect(outcome.ok).toBe(true);
    expect(uploadMediaDirect).not.toHaveBeenCalled();
    const body = sendInboxMessage.mock.calls[0][0].body as Record<string, unknown>;
    expect(body.attachmentUrl).toBeUndefined();
    expect(body.message).toBe("hola");
  });
});

describe("audio por WhatsApp (F19)", () => {
  it("sube una URL FIRMADA (10 min) y manda con sendWhatsAppAudio", async () => {
    const { memory, signedUrls } = db();

    const outcome = await sendChannelMessage(memory.client, waContext, {
      text: "",
      media: { kind: "voice", storagePath: "ws-1/cv-1/out-1.webm", mime: "audio/webm" },
    });

    expect(outcome).toEqual({ ok: true, platformMessageId: "wa-audio-1" });
    expect(signedUrls).toEqual(["ws-1/cv-1/out-1.webm"]);
    expect(sendWhatsAppAudio).toHaveBeenCalledWith(
      expect.anything(),
      "ssa-1",
      "5491122334455",
      "https://signed.test/ws-1/cv-1/out-1.webm",
    );
    // Por WhatsApp NO se valida el formato: Evolution convierte cualquiera.
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("una imagen por WhatsApp usa sendMedia, no sendWhatsAppAudio", async () => {
    const { memory } = db();
    await sendChannelMessage(memory.client, waContext, {
      text: "mirá",
      media: { kind: "image", storagePath: "ws-1/cv-1/out-2.jpg", mime: "image/jpeg", filename: "foto.jpg" },
    });

    expect(sendMedia).toHaveBeenCalledWith(expect.anything(), "ssa-1", "5491122334455", {
      media: "https://signed.test/ws-1/cv-1/out-2.jpg",
      mediatype: "image",
      mimetype: "image/jpeg",
      fileName: "foto.jpg",
      caption: "mirá",
    });
  });
});

describe("audio por Instagram (F19)", () => {
  it("se sube a Zernio con uploadMediaDirect y se usa ESA url, nunca una firmada de Supabase", async () => {
    const { memory, downloads, signedUrls } = db();

    const outcome = await sendChannelMessage(memory.client, igContext, {
      text: "",
      media: { kind: "voice", storagePath: "ws-1/cv-1/out-3.m4a", mime: "audio/mp4" },
    });

    expect(outcome).toEqual({ ok: true, platformMessageId: "ig-1" });
    expect(downloads).toEqual(["ws-1/cv-1/out-3.m4a"]);
    expect(signedUrls).toHaveLength(0); // nunca se firma nada para Zernio
    expect(uploadMediaDirect).toHaveBeenCalledWith({
      body: { file: expect.any(Blob), contentType: "audio/mp4" },
    });
    const body = sendInboxMessage.mock.calls[0][0].body as Record<string, unknown>;
    expect(body.attachmentUrl).toBe("https://cdn.zernio.test/u/audio.m4a");
    expect(body.attachmentType).toBe("audio");
  });

  it("ogg/opus se rechaza ANTES de subir nada a Zernio", async () => {
    const { memory } = db();

    const outcome = await sendChannelMessage(memory.client, igContext, {
      text: "",
      media: { kind: "voice", storagePath: "ws-1/cv-1/out-4.ogg", mime: "audio/ogg" },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.failure?.message).toContain("Instagram no acepta este formato de audio");
    expect(uploadMediaDirect).not.toHaveBeenCalled();
    expect(sendInboxMessage).not.toHaveBeenCalled();
  });

  it("webm tambien se rechaza para Instagram", async () => {
    const { memory } = db();
    const outcome = await sendChannelMessage(memory.client, igContext, {
      text: "",
      media: { kind: "voice", storagePath: "ws-1/cv-1/out-5.webm", mime: "audio/webm;codecs=opus" },
    });
    expect(outcome.ok).toBe(false);
    expect(uploadMediaDirect).not.toHaveBeenCalled();
  });
});

describe("el bug arreglado: un flow con media por Evolution ahora SI se manda", () => {
  it("mediaUrl (legado) ya no se descarta en silencio", async () => {
    const { memory } = db();

    const outcome = await sendChannelMessage(memory.client, waContext, {
      text: "mirá la promo",
      mediaUrl: "https://cdn.content.test/promo.jpg",
      mediaType: "image",
    });

    expect(outcome.ok).toBe(true);
    expect(sendMedia).toHaveBeenCalledWith(expect.anything(), "ssa-1", "5491122334455", {
      media: "https://cdn.content.test/promo.jpg",
      mediatype: "image",
      mimetype: undefined,
      fileName: undefined,
      caption: "mirá la promo",
    });
  });
});
