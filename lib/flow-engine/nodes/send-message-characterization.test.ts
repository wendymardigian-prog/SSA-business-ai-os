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
const sendPrivateReply = vi.fn(async (_args: unknown) => ({}));
vi.mock("@/lib/zernio-client", () => ({ createZernioClient: () => ({ comments: { sendPrivateReplyToComment: (a: unknown) => sendPrivateReply(a) } }) }));
vi.mock("@/lib/integrations/zernio-key", () => ({ getZernioApiKey: async () => "zk-test" }));

import { sendMessageNode } from "./send-message";

beforeEach(() => {
  sendChannelMessage.mockClear();
  recordSend.mockClear();
  sendPrivateReply.mockClear();
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

/**
 * Caracterizacion de lo que RECIBE `sendChannelMessage` / la respuesta privada, ANTES del interruptor «Agregar
 * parámetros de atribución» (Extra I, F39). Un nodo SIN `attribution` (o con `append` apagado) tiene que mandar
 * EXACTAMENTE esto: botones URL, carrusel, link en el texto, WhatsApp aplanado a texto y el respaldo por respuesta
 * privada. Estos casos se escribieron sobre el código anterior al cambio y no se tocan.
 */
describe("sendMessage: lo que se manda con el interruptor de atribución apagado o ausente (Extra I, F39)", () => {
  const URL_TEXT = "Mirá https://example.com/programa y escribime";
  const base = { triggerId: "tr-1", flowId: "11111111-2222-4333-8444-555555555555", channelId: "ch-1", contactId: "c-1", conversationId: "conv-1", workspaceId: "ws-1", incomingMessage: {}, variables: { nombre: "Ana" } };

  async function run(platform: string, data: Record<string, unknown>, contextOver: Record<string, unknown> = {}) {
    const db = memoryDb({ channels: [{ id: "ch-1", platform, late_account_id: "acc-1" }], conversations: [{ id: "conv-1", late_conversation_id: "lc-1" }], contacts: [{ id: "c-1" }], flows: [{ id: base.flowId, name: "Info del reel" }] });
    await sendMessageNode.execute({
      supabase: db.client,
      node: { id: "n-1", type: "sendMessage", data: {} } as never,
      data: data as never,
      context: { ...base, ...contextOver } as never,
      sessionId: "s-1",
      runtime: { executeFlow: async () => {} },
    });
    return sendChannelMessage.mock.calls.map((c) => (c as unknown as [unknown, unknown, Record<string, unknown>])[2]);
  }
  const off = [undefined, { append: false, trackClicks: true }];

  for (const attribution of off) {
    const label = attribution ? "con append apagado" : "sin la clave";
    it(`Instagram, link en el texto y botón URL (${label})`, async () => {
      const [m] = await run("instagram", { attribution, messages: [{ text: URL_TEXT, buttons: [{ title: "Ver", type: "url", url: "https://example.com/programa" }, { title: "Hola", type: "postback", payload: "p1" }] }] });
      expect(m).toEqual({
        text: URL_TEXT, mediaUrl: undefined, mediaType: undefined, quickReplies: undefined, template: undefined, replyMarkup: undefined,
        buttons: [{ title: "Ver", type: "url", url: "https://example.com/programa" }, { title: "Hola", type: "postback", payload: "p1" }],
      });
    });

    it(`Instagram, carrusel con botón URL (${label})`, async () => {
      const [m] = await run("instagram", { attribution, messages: [{ text: "x", carousel: { elements: [{ title: "Uno", buttons: [{ type: "url", title: "Abrir", url: "https://example.com/a?x=1" }] }] } }] });
      expect(m.template).toEqual({ type: "generic", elements: [{ title: "Uno", subtitle: undefined, imageUrl: undefined, buttons: [{ type: "url", title: "Abrir", url: "https://example.com/a?x=1", payload: undefined }] }] });
    });

    it(`WhatsApp, el botón URL baja a texto con el link tal cual (${label})`, async () => {
      const [m] = await run("whatsapp", { attribution, messages: [{ text: "Hola", buttons: [{ title: "Ver", type: "url", url: "https://example.com/programa" }] }] });
      expect(m.text).toBe("Hola\n\n1. Ver: https://example.com/programa");
      expect(m.buttons).toBeUndefined();
    });

    it(`respaldo por respuesta privada: sale solo el primer mensaje, el texto tal cual (${label})`, async () => {
      const db = memoryDb({ channels: [{ id: "ch-1", platform: "instagram", late_account_id: "acc-1" }], conversations: [{ id: "conv-1", late_conversation_id: null }], contacts: [{ id: "c-1" }], messages: [] });
      await sendMessageNode.execute({
        supabase: db.client,
        node: { id: "n-1", type: "sendMessage", data: {} } as never,
        data: { attribution, messages: [{ text: URL_TEXT, buttons: [{ title: "Ver", type: "url", url: "https://example.com/programa" }] }, { text: "segundo" }] } as never,
        context: { ...base, variables: { comment_id: "cm-1", post_id: "po-1" } } as never,
        sessionId: "s-1",
        runtime: { executeFlow: async () => {} },
      });
      expect(sendChannelMessage).not.toHaveBeenCalled();
      expect(sendPrivateReply).toHaveBeenCalledTimes(1);
      expect(sendPrivateReply.mock.calls[0][0]).toEqual({ path: { postId: "po-1", commentId: "cm-1" }, body: { accountId: "acc-1", message: URL_TEXT } });
    });
  }
});
