import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { ensureZernioConversation, handleMessageSentEcho, upsertConversation } from "./inbound";

/**
 * Las conversaciones que empieza el negocio (00267): el eco `message.sent` del
 * primer mensaje y `conversation.started` las crean, en vez de descartarlas hasta
 * que la persona responda.
 */

const channel = { id: "ch-1", workspace_id: "ws-1", platform: "instagram" as const };

function setup(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  let n = 0;
  return memoryDb(
    { conversations: [], messages: [], ...seed },
    {
      rpc: {
        // La regla unica de contactos vive en la base: aca, un contacto por remitente.
        find_or_link_contact: (args) => ({
          contact_id: (seed.known as Array<{ sender: string; contact: string }> | undefined)?.find(
            (k) => k.sender === args.p_sender_id,
          )?.contact ?? `contact-${++n}`,
          existed: false,
        }),
        assign_new_conversation: () => null,
      },
      unique: {
        conversations: (a, b) => a.channel_id === b.channel_id && a.contact_id === b.contact_id,
      },
    },
  );
}

const participant = {
  id: "zc-1",
  participantId: "igsid-1",
  participantName: "Stefania",
  participantUsername: "stefiwilches",
  participantPicture: "https://cdn/x.jpg",
};

const echo = {
  id: "z-msg-1",
  conversationId: "zc-1",
  platformMessageId: "meta-mid-1",
  direction: "outgoing",
  text: "¡Hola! Te paso la guía",
  sentAt: "2026-10-28T10:00:00Z",
};

describe("el eco de una conversacion que empezo el negocio", () => {
  it("crea el contacto, la conversacion (sin no leidos) y guarda el mensaje", async () => {
    const db = setup();

    const res = await handleMessageSentEcho({ supabase: db.client, channel, message: echo, conversation: participant });

    expect(res.stored).toBe(true);
    const find = db.rpcCalls.find((c) => c.name === "find_or_link_contact");
    expect(find?.args).toMatchObject({
      p_channel_id: "ch-1",
      p_sender_id: "igsid-1",
      p_display_name: "Stefania",
      p_username: "stefiwilches",
      p_stamp_existing: false,
    });
    const [conv] = db.rows("conversations");
    expect(conv).toMatchObject({
      workspace_id: "ws-1",
      channel_id: "ch-1",
      contact_id: "contact-1",
      late_conversation_id: "zc-1",
      unread_count: 0,
      status: "open",
    });
    const [msg] = db.rows("messages");
    expect(msg).toMatchObject({ conversation_id: conv.id, direction: "outbound", origin: "external", platform_message_id: "z-msg-1" });
  });

  it("si la persona ya tiene su conversacion (sin id de Zernio), usa esa y completa el id", async () => {
    const db = setup({
      known: [{ sender: "igsid-1", contact: "contact-viejo" }] as never,
      conversations: [{ id: "conv-vieja", channel_id: "ch-1", contact_id: "contact-viejo", late_conversation_id: null, status: "closed" }],
    });

    const res = await handleMessageSentEcho({ supabase: db.client, channel, message: echo, conversation: participant });

    expect(res).toMatchObject({ stored: true, conversationId: "conv-vieja" });
    expect(db.rows("conversations")).toHaveLength(1);
    // No se reabre ni se mueve: es un mensaje nuestro.
    expect(db.rows("conversations")[0]).toMatchObject({ late_conversation_id: "zc-1", status: "closed" });
  });

  it("con la conversacion ya conocida no resuelve ningun contacto (igual que antes)", async () => {
    const db = setup({ conversations: [{ id: "conv-1", channel_id: "ch-1", contact_id: "c-1", late_conversation_id: "zc-1" }] });

    const res = await handleMessageSentEcho({ supabase: db.client, channel, message: echo, conversation: participant });

    expect(res).toMatchObject({ stored: true, conversationId: "conv-1" });
    expect(db.rpcCalls.some((c) => c.name === "find_or_link_contact")).toBe(false);
  });

  it("sin la persona (Zernio no la mando), se saltea como antes", async () => {
    const db = setup();

    const res = await handleMessageSentEcho({ supabase: db.client, channel, message: echo, conversation: { id: "zc-1" } });

    expect(res).toEqual({ stored: false, reason: "conversación no encontrada" });
    expect(db.rows("conversations")).toHaveLength(0);
  });
});

describe("ensureZernioConversation", () => {
  it("sin participantId no hace nada", async () => {
    const db = setup();
    const res = await ensureZernioConversation({
      supabase: db.client,
      channel,
      lateConversationId: "zc-1",
      participant: { id: "zc-1" },
      at: "2026-10-28T10:00:00Z",
      preview: "",
    });
    expect(res).toBeNull();
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("un nombre que falta se completa con el @ o el id, nunca queda vacio", async () => {
    const db = setup();
    await ensureZernioConversation({
      supabase: db.client,
      channel,
      lateConversationId: "zc-1",
      participant: { participantId: "igsid-9", participantUsername: "solo_usuario" },
      at: "2026-10-28T10:00:00Z",
      preview: "",
    });
    expect(db.rpcCalls[0].args.p_display_name).toBe("solo_usuario");
  });
});

describe("upsertConversation con dos llegadas a la vez", () => {
  it("si otra llegada la creo en el mismo instante, usa esa en vez de perder el mensaje", async () => {
    // La primera lectura no la ve (todavia no existia); el insert choca con el
    // indice unico; la segunda lectura encuentra la que gano.
    const reads = [null, { id: "conv-ganadora", is_automation_paused: false }];
    const updates: unknown[] = [];
    const client = {
      from() {
        const b: Record<string, unknown> = {};
        const chain = () => b;
        b.select = chain;
        b.eq = chain;
        b.is = chain;
        b.maybeSingle = async () => ({ data: reads.shift() ?? null, error: null });
        b.insert = () => ({
          select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) }),
        });
        b.update = (v: unknown) => {
          updates.push(v);
          return b;
        };
        return b;
      },
      rpc: vi.fn(),
    } as unknown as SupabaseClient<Database>;

    const res = await upsertConversation({
      supabase: client,
      channel,
      contactId: "c-1",
      externalConversationId: "zc-1",
      preview: "hola",
      at: "2026-10-28T10:00:00Z",
      incrementUnread: true,
    });

    expect(res).toEqual({ id: "conv-ganadora", isAutomationPaused: false });
    expect(updates).toEqual([{ late_conversation_id: "zc-1" }]);
  });
});
