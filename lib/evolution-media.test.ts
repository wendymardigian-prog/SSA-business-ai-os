/**
 * La media de WhatsApp (F4).
 *
 * WhatsApp manda la media cifrada, asi que el archivo se le pide a Evolution por
 * el id del mensaje. Lo que importa: que una foto con caption no pierda la foto
 * (el bug que se arregla), que una nota de voz conserve su duracion, que lo que
 * no tiene archivo no se pida, y que un error de Evolution no rompa nada.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { EvolutionError, type EvolutionConfig } from "@/lib/evolution-client";
import { emptyAttachment, type ChatAttachment } from "@/lib/messages/attachments";

const { getBase64FromMediaMessage } = vi.hoisted(() => ({ getBase64FromMediaMessage: vi.fn() }));
vi.mock("@/lib/evolution-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/evolution-client")>();
  return { ...actual, getBase64FromMediaMessage };
});

import { describeWhatsappMessage, evolutionMediaFetcher, storeEvolutionMedia } from "./evolution-media";

const WS = "ws-1";
const CV = "cv-1";
const MSG = "m-1";
const config: EvolutionConfig = { baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" };

function db() {
  const uploads: Array<{ path: string; bytes: number; contentType?: string }> = [];
  const memory = memoryDb({
    workspaces: [{ id: WS, persist_chat_media: true }],
    messages: [{ id: MSG, conversation_id: CV, workspace_id: WS, attachments: null }],
  });
  (memory.client as unknown as { storage: unknown }).storage = {
    from: () => ({
      upload: async (path: string, bytes: Uint8Array, opts?: { contentType?: string }) => {
        uploads.push({ path, bytes: bytes.byteLength, contentType: opts?.contentType });
        return { error: null };
      },
    }),
  };
  return { memory, uploads };
}

const store = (items: ChatAttachment[], platformMessageId: string | null = "WA-1") =>
  storeEvolutionMedia({
    supabase: db().memory.client,
    config,
    instance: "ssa-1",
    workspaceId: WS,
    conversationId: CV,
    messageId: MSG,
    platformMessageId,
    items,
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describeWhatsappMessage (F4)", () => {
  it("una imagen CON caption devuelve el adjunto: el caption no lo tapa", () => {
    // Este es el bug: `attachments: text ? null : data.message` perdia la foto
    // porque extractText devuelve el caption.
    const items = describeWhatsappMessage({
      imageMessage: { mimetype: "image/jpeg", caption: "mira el presupuesto", fileLength: "40213" },
    });

    expect(items).toEqual([
      expect.objectContaining({ kind: "image", mime: "image/jpeg", sizeBytes: 40213, status: "pending" }),
    ]);
  });

  it("una nota de voz trae su duracion y su mime sin parametros", () => {
    const items = describeWhatsappMessage({
      audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 12, ptt: true },
    });

    expect(items[0]).toMatchObject({ kind: "voice", durationSeconds: 12, mime: "audio/ogg" });
  });

  it("una ubicacion, un contacto y una encuesta quedan sin archivo que bajar", () => {
    expect(describeWhatsappMessage({ locationMessage: { degreesLatitude: 1, degreesLongitude: 2 } })[0]).toMatchObject({
      kind: "location",
      status: "none",
    });
    expect(describeWhatsappMessage({ contactMessage: { displayName: "Juan" } })[0].status).toBe("none");
    expect(describeWhatsappMessage({ pollCreationMessage: { name: "Que dia?" } })[0].status).toBe("none");
  });

  it("un nodo de protocolo no es un adjunto", () => {
    expect(describeWhatsappMessage({ protocolMessage: { type: "REVOKE" } })).toEqual([]);
    expect(describeWhatsappMessage({ conversation: "hola" })).toEqual([]);
  });
});

describe("storeEvolutionMedia: el camino feliz (F4)", () => {
  it("pide el archivo a Evolution, lo sube y deja el item listo", async () => {
    const { memory, uploads } = db();
    getBase64FromMediaMessage.mockResolvedValue({
      // "OggS", la cabecera de un ogg.
      base64: Buffer.from([0x4f, 0x67, 0x67, 0x53]).toString("base64"),
      mimetype: "audio/ogg; codecs=opus",
      fileName: null,
      size: 4,
    });

    const result = await storeEvolutionMedia({
      supabase: memory.client,
      config,
      instance: "ssa-1",
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      platformMessageId: "WA-1",
      items: [emptyAttachment("voice", { status: "pending", durationSeconds: 12 })],
    });

    expect(getBase64FromMediaMessage).toHaveBeenCalledWith(config, "ssa-1", "WA-1");
    expect(result.stored).toBe(1);
    expect(result.items[0]).toMatchObject({
      kind: "voice",
      status: "ready",
      mime: "audio/ogg",
      durationSeconds: 12,
      sizeBytes: 4,
    });
    expect(uploads[0].path).toBe(`${WS}/${CV}/${MSG}-0.ogg`);
  });

  it("no le pide dos veces el mismo archivo: todos los adjuntos comparten el id", async () => {
    const { memory } = db();
    getBase64FromMediaMessage.mockResolvedValue({
      base64: Buffer.from([1, 2, 3, 4]).toString("base64"),
      mimetype: "image/jpeg",
      fileName: null,
      size: 4,
    });

    await storeEvolutionMedia({
      supabase: memory.client,
      config,
      instance: "ssa-1",
      workspaceId: WS,
      conversationId: CV,
      messageId: MSG,
      platformMessageId: "WA-1",
      items: [emptyAttachment("image", { status: "pending" }), emptyAttachment("image", { status: "pending" })],
    });

    expect(getBase64FromMediaMessage).toHaveBeenCalledTimes(1);
  });
});

describe("storeEvolutionMedia: lo que sale mal (F4)", () => {
  it("si Evolution no devuelve base64, el item queda failed con un motivo entendible", async () => {
    getBase64FromMediaMessage.mockResolvedValue(null);

    const result = await store([emptyAttachment("voice", { status: "pending" })]);

    expect(result.items[0]).toMatchObject({
      status: "failed",
      error: "WhatsApp ya no tiene este archivo disponible",
    });
  });

  it("un error de Evolution deja el motivo con su estado, y NO lanza", async () => {
    getBase64FromMediaMessage.mockRejectedValue(new EvolutionError("Evolution API respondio 400: nope", 400));

    const result = await store([emptyAttachment("image", { status: "pending" })]);

    expect(result.items[0].status).toBe("failed");
    expect(result.items[0].error).toContain("400");
  });

  it("un error inesperado tampoco lanza", async () => {
    getBase64FromMediaMessage.mockRejectedValue(new Error("boom"));

    const result = await store([emptyAttachment("image", { status: "pending" })]);

    expect(result.items[0].status).toBe("failed");
    expect(result.items[0].error).toContain("Reintentar");
  });

  it("sin id del mensaje no se puede pedir nada, y se dice asi", async () => {
    const result = await store([emptyAttachment("image", { status: "pending" })], null);

    expect(getBase64FromMediaMessage).not.toHaveBeenCalled();
    expect(result.items[0].error).toContain("sin identificador");
  });

  it("un base64 que decodifica a cero bytes se marca, no se sube", async () => {
    getBase64FromMediaMessage.mockResolvedValue({ base64: "====", mimetype: "image/jpeg", fileName: null, size: 0 });

    const result = await store([emptyAttachment("image", { status: "pending" })]);

    expect(result.items[0]).toMatchObject({ status: "failed", error: "El archivo llegó vacío" });
  });
});

describe("el fetcher, aislado", () => {
  it("devuelve los bytes decodificados y el mime que dijo Evolution", async () => {
    getBase64FromMediaMessage.mockResolvedValue({
      base64: Buffer.from("hola").toString("base64"),
      mimetype: "audio/mp4",
      fileName: "PTT-20260928.m4a",
      size: 4,
    });

    const fetcher = evolutionMediaFetcher({ config, instance: "ssa-1", platformMessageId: "WA-1" });
    const source = await fetcher(emptyAttachment("voice", { status: "pending" }), 0);

    expect(source).toMatchObject({ kind: "bytes", mime: "audio/mp4" });
    expect(source.kind === "bytes" && Buffer.from(source.bytes).toString()).toBe("hola");
  });
});
