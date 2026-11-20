/**
 * Reintentar la media de WhatsApp: se le pide a Evolution por el id del mensaje,
 * solo se tocan los adjuntos fallidos, y lo que no es de WhatsApp no se toca.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { emptyAttachment, toAttachmentsColumn, parseAttachments } from "@/lib/messages/attachments";

vi.mock("@/lib/chat-media/after-stored", () => ({ afterMediaStored: vi.fn(async () => ({})) }));

import { retryWhatsappMedia, whatsappRetryableItems } from "./whatsapp-retry";
import { afterMediaStored } from "@/lib/chat-media/after-stored";

const WS = "ws-1";

function setup(opts: { platform?: string; attachments?: unknown; platformMessageId?: string | null } = {}) {
  const memory = memoryDb({
    workspaces: [{ id: WS, persist_chat_media: true }],
    channels: [{ id: "ch-1", workspace_id: WS, platform: opts.platform ?? "whatsapp", evolution_instance: "ssa-1" }],
    conversations: [{ id: "cv-1", workspace_id: WS, channel_id: "ch-1" }],
    messages: [
      {
        id: "m-1",
        workspace_id: WS,
        conversation_id: "cv-1",
        platform_message_id: opts.platformMessageId === undefined ? "WA-1" : opts.platformMessageId,
        attachments:
          opts.attachments ??
          toAttachmentsColumn([
            emptyAttachment("voice", { status: "failed", error: "No pudimos traer el archivo de WhatsApp (Evolution respondió 400)" }),
          ]),
      },
    ],
  });
  (memory.client as unknown as { storage: unknown }).storage = {
    from: () => ({ upload: async () => ({ error: null }) }),
  };
  return memory;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("whatsappRetryableItems", () => {
  it("vuelve a pending solo lo fallido sin URL ni archivo", () => {
    const items = whatsappRetryableItems([
      emptyAttachment("voice", { status: "failed", error: "x" }),
      emptyAttachment("image", { status: "ready", storagePath: "ws/cv/a.jpg" }),
      emptyAttachment("image", { status: "failed", sourceUrl: "https://cdn.test/a.jpg" }),
    ]);
    expect(items.map((i) => i.status)).toEqual(["pending", "ready", "failed"]);
    expect(items[0].error).toBeNull();
  });
});

describe("retryWhatsappMedia", () => {
  it("baja el archivo, lo guarda y sigue con la transcripcion", async () => {
    const memory = setup();
    const fetcher = vi.fn(async () => ({ kind: "bytes" as const, bytes: new Uint8Array([1, 2, 3]), mime: "audio/ogg" }));

    const result = await retryWhatsappMedia({ service: memory.client, messageId: "m-1", fetcher });

    expect(result).toEqual({ kind: "retried", stored: 1, failed: 0 });
    const row = memory.tables.messages.find((m) => m.id === "m-1");
    expect(parseAttachments(row?.attachments)[0]).toMatchObject({ status: "ready" });
    expect(afterMediaStored).toHaveBeenCalledTimes(1);
  });

  it("un mensaje que no es de WhatsApp no se toca", async () => {
    const memory = setup({ platform: "instagram" });
    const fetcher = vi.fn();
    expect(await retryWhatsappMedia({ service: memory.client, messageId: "m-1", fetcher })).toEqual({
      kind: "skipped",
      reason: "not_whatsapp",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sin nada fallido no pide nada", async () => {
    const memory = setup({
      attachments: toAttachmentsColumn([emptyAttachment("voice", { status: "ready", storagePath: "ws/cv/a.ogg" })]),
    });
    const fetcher = vi.fn();
    expect(await retryWhatsappMedia({ service: memory.client, messageId: "m-1", fetcher })).toEqual({
      kind: "skipped",
      reason: "nothing_to_retry",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sin id de WhatsApp no se puede pedir", async () => {
    const memory = setup({ platformMessageId: null });
    expect(await retryWhatsappMedia({ service: memory.client, messageId: "m-1", fetcher: vi.fn() })).toEqual({
      kind: "skipped",
      reason: "no_message_id",
    });
  });
});
