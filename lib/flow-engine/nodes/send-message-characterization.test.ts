/**
 * Caracterizacion del nodo `sendMessage` ANTES de la Etapa 4.
 *
 * Fija que HOY el nodo NO mira `contacts.do_not_contact`: manda igual por
 * WhatsApp o Instagram. Solo el canal de email lo respeta (adentro de
 * `sendChannelMessage`). El nodo nuevo `send_email` (B7a) si lo respeta,
 * salvo cuando el flow arranco por un trigger de agenda. Este test es la
 * evidencia de que ese comportamiento viejo no cambia con la Etapa 4.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const sendChannelMessage = vi.fn(async () => ({ ok: true, platformMessageId: "pm-1" }));
const recordSend = vi.fn(async () => {});

vi.mock("../send", () => ({
  sendChannelMessage: (...a: unknown[]) => sendChannelMessage(...(a as [])),
  recordSend: (...a: unknown[]) => recordSend(...(a as [])),
}));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: () => ({}) }));
vi.mock("@/lib/integrations/zernio-key", () => ({ getZernioApiKey: async () => null }));

import { sendMessageNode } from "./send-message";

beforeEach(() => {
  sendChannelMessage.mockClear();
  recordSend.mockClear();
});

describe("sendMessage (caracterizacion previa a la etapa 4)", () => {
  it("manda aunque el contacto tenga do_not_contact (WhatsApp)", async () => {
    const db = memoryDb({
      channels: [{ id: "ch-1", platform: "whatsapp" }],
      contacts: [{ id: "c-1", do_not_contact: true }],
    });
    const context = {
      triggerId: "tr-1",
      flowId: "flow-1",
      channelId: "ch-1",
      contactId: "c-1",
      conversationId: "conv-1",
      workspaceId: "ws-1",
      incomingMessage: {},
      variables: { nombre: "Ana" },
    };
    await sendMessageNode.execute({
      supabase: db.client,
      node: { id: "n-1", type: "sendMessage", data: {} } as never,
      data: { messages: [{ text: "Hola {{nombre}}" }] } as never,
      context: context as never,
      sessionId: "s-1",
      runtime: { executeFlow: async () => {} },
    });
    expect(sendChannelMessage).toHaveBeenCalledTimes(1);
    const [, , message] = sendChannelMessage.mock.calls[0] as unknown as [unknown, unknown, { text: string }];
    expect(message.text).toBe("Hola Ana");
    expect(recordSend).toHaveBeenCalledTimes(1);
  });
});
