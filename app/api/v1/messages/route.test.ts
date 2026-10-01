/**
 * POST /api/v1/messages (F19).
 *
 * Lo mas importante, primero: el envio de TEXTO SIN MEDIA sigue funcionando
 * exactamente igual que antes de sumar `media` al contrato (no-regresion).
 * Despues, lo nuevo: `media` es el unico camino de envio con archivo, pasa
 * por `sendChannelMessage` (el mismo que usan los flows), se valida por
 * magic bytes y por pertenencia a la conversacion, y un envio fallido
 * responde con el motivo sin romper nada.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { sendChannelMessage } = vi.hoisted(() => ({ sendChannelMessage: vi.fn() }));
vi.mock("@/lib/flow-engine/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/flow-engine/send")>();
  return { ...actual, sendChannelMessage };
});

const { applyManualReply } = vi.hoisted(() => ({ applyManualReply: vi.fn(async () => true) }));
vi.mock("@/lib/agent/manual-reply", () => ({ applyManualReply }));

const { afterMediaStored } = vi.hoisted(() => ({ afterMediaStored: vi.fn(async () => ({})) }));
vi.mock("@/lib/chat-media/after-stored", () => ({ afterMediaStored }));

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { POST } from "./route";

const CONV = "cv-1";
const WS = "ws-1";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

interface World {
  user?: boolean;
  conversation?: Record<string, unknown> | null;
  storageBytes?: Uint8Array;
  storageError?: boolean;
  insertError?: { code: string; message: string } | null;
}

function fakeClient(world: World = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const storageDownloads: string[] = [];

  const client = {
    auth: { getUser: async () => ({ data: { user: world.user === false ? null : { id: "u-1" } } }) },
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: table === "conversations" ? (world.conversation ?? null) : null, error: null }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return {
            select: () => ({
              single: async () =>
                world.insertError
                  ? { data: null, error: world.insertError }
                  : { data: { id: "msg-out-1", ...row }, error: null },
            }),
          };
        },
        update: (patch: Record<string, unknown>) => {
          updates.push({ table, patch });
          return { eq: async () => ({ error: null }) };
        },
      };
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          storageDownloads.push(path);
          if (world.storageError) return { data: null, error: { message: "not found" } };
          const bytes = world.storageBytes ?? JPEG_BYTES;
          return { data: new Blob([bytes.slice().buffer]), error: null };
        },
      }),
    },
  };

  return { client, inserts, updates, storageDownloads };
}

function conversation(over: Record<string, unknown> = {}) {
  return {
    id: CONV,
    workspace_id: WS,
    contact_id: "c-1",
    late_conversation_id: "late-cv-1",
    channels: { id: "ch-1", workspace_id: WS, provider: "evolution", platform: "whatsapp", evolution_instance: "ssa-1", late_account_id: null, email_address: null, is_active: true },
    contacts: { do_not_contact: false, do_not_contact_reason: null },
    ...over,
  };
}

const call = (body: Record<string, unknown>) =>
  POST(new NextRequest("https://app.test/api/v1/messages", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  sendChannelMessage.mockResolvedValue({ ok: true, platformMessageId: "pm-1" });
});

describe("POST /api/v1/messages: texto sin media (no-regresion)", () => {
  it("sin sesion, 401", async () => {
    const { client } = fakeClient({ user: false });
    createClient.mockResolvedValue(client);
    expect((await call({ conversationId: CONV, text: "hola" })).status).toBe(401);
  });

  it("sin conversationId ni text ni media, 400", async () => {
    const { client } = fakeClient();
    createClient.mockResolvedValue(client);
    const response = await call({ conversationId: CONV });
    expect(response.status).toBe(400);
  });

  it("conversacion inexistente, 404", async () => {
    const { client } = fakeClient({ conversation: null });
    createClient.mockResolvedValue(client);
    expect((await call({ conversationId: CONV, text: "hola" })).status).toBe(404);
  });

  it("contacto marcado 'no contactar' sin confirmar, 409", async () => {
    const { client } = fakeClient({ conversation: conversation({ contacts: { do_not_contact: true, do_not_contact_reason: "pidió que no le escriban" } }) });
    createClient.mockResolvedValue(client);
    const response = await call({ conversationId: CONV, text: "hola" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ requiresConfirmation: true });
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("confirmado, manda igual a un contacto 'no contactar'", async () => {
    const { client } = fakeClient({ conversation: conversation({ contacts: { do_not_contact: true, do_not_contact_reason: "x" } }) });
    createClient.mockResolvedValue(client);
    const response = await call({ conversationId: CONV, text: "hola", confirmedDoNotContact: true });
    expect(response.status).toBe(201);
  });

  it("WhatsApp: manda por sendChannelMessage con el texto, sin media, y guarda la fila", async () => {
    const { client, inserts, updates } = fakeClient({ conversation: conversation() });
    createClient.mockResolvedValue(client);

    const response = await call({ conversationId: CONV, text: "hola, como estas" });

    expect(response.status).toBe(201);
    expect(sendChannelMessage).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ workspaceId: WS, channelId: "ch-1", conversationId: CONV }),
      { text: "hola, como estas", media: undefined },
    );
    const inserted = inserts.find((i) => i.table === "messages");
    expect(inserted?.row).toMatchObject({ origin: "user", status: "sent", text: "hola, como estas" });
    expect(updates.find((u) => u.table === "conversations")?.patch).toMatchObject({ last_message_preview: "hola, como estas" });
    expect(applyManualReply).toHaveBeenCalledWith(client, { conversationId: CONV, workspaceId: WS, userId: "u-1" });
    expect(afterMediaStored).not.toHaveBeenCalled();
  });

  it("Instagram: mismo camino, sendChannelMessage con lateConversationId/lateAccountId", async () => {
    const { client } = fakeClient({
      conversation: conversation({
        channels: { id: "ch-ig", workspace_id: WS, provider: "late", platform: "instagram", late_account_id: "acc-1", evolution_instance: null, email_address: null, is_active: true },
      }),
    });
    createClient.mockResolvedValue(client);

    const response = await call({ conversationId: CONV, text: "hola" });

    expect(response.status).toBe(201);
    expect(sendChannelMessage).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ channelId: "ch-ig", lateConversationId: "late-cv-1", lateAccountId: "acc-1" }),
      { text: "hola", media: undefined },
    );
  });

  it("un envio que falla responde con el motivo, y el status segun si es reintentable", async () => {
    sendChannelMessage.mockResolvedValue({ ok: false, failure: { kind: "unknown", message: "No se pudo enviar.", retryable: true } });
    const { client, inserts } = fakeClient({ conversation: conversation() });
    createClient.mockResolvedValue(client);

    const response = await call({ conversationId: CONV, text: "hola" });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "No se pudo enviar." });
    // Igual queda guardado como failed, con el motivo en el texto.
    const inserted = inserts.find((i) => i.table === "messages");
    expect(inserted?.row).toMatchObject({ status: "failed", text: "No se pudo enviar." });
  });
});

describe("POST /api/v1/messages: con media (F19)", () => {
  it("un audio valido se manda con media y queda guardado en formato v2", async () => {
    const { client, inserts, storageDownloads } = fakeClient({ conversation: conversation(), storageBytes: new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0]) });
    createClient.mockResolvedValue(client);

    const response = await call({
      conversationId: CONV,
      text: "",
      media: { storagePath: `${WS}/${CONV}/out-1.ogg`, kind: "voice", mime: "audio/ogg", durationSeconds: 8 },
    });

    expect(response.status).toBe(201);
    expect(storageDownloads).toEqual([`${WS}/${CONV}/out-1.ogg`]);
    const call1 = sendChannelMessage.mock.calls[0] as unknown as [unknown, unknown, { media?: { kind: string; storagePath: string } }];
    expect(call1[2].media).toMatchObject({ kind: "voice", storagePath: `${WS}/${CONV}/out-1.ogg` });

    const inserted = inserts.find((i) => i.table === "messages");
    const attachments = inserted?.row.attachments as { v: number; items: Array<{ kind: string; status: string }> };
    expect(attachments.v).toBe(2);
    expect(attachments.items[0]).toMatchObject({ kind: "voice", status: "ready" });

    expect(afterMediaStored).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: client, messageId: "msg-out-1" }),
    );
  });

  it("un path que no pertenece a esta conversacion se rechaza sin llamar a sendChannelMessage", async () => {
    const { client } = fakeClient({ conversation: conversation() });
    createClient.mockResolvedValue(client);

    const response = await call({
      conversationId: CONV,
      media: { storagePath: `${WS}/otra-conversacion/out-1.jpg`, kind: "image", mime: "image/jpeg" },
    });

    expect(response.status).toBe(400);
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("un archivo cuyos bytes no coinciden con el kind declarado se rechaza (magic bytes)", async () => {
    // Declara "image" pero el contenido es un ogg.
    const { client } = fakeClient({
      conversation: conversation(),
      storageBytes: new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0]),
    });
    createClient.mockResolvedValue(client);

    const response = await call({
      conversationId: CONV,
      media: { storagePath: `${WS}/${CONV}/out-2.jpg`, kind: "image", mime: "image/jpeg" },
    });

    expect(response.status).toBe(400);
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("si no se puede bajar el archivo, 400 sin llamar a sendChannelMessage", async () => {
    const { client } = fakeClient({ conversation: conversation(), storageError: true });
    createClient.mockResolvedValue(client);

    const response = await call({
      conversationId: CONV,
      media: { storagePath: `${WS}/${CONV}/out-3.jpg`, kind: "image", mime: "image/jpeg" },
    });

    expect(response.status).toBe(400);
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("el email no admite adjuntos todavia", async () => {
    const { client } = fakeClient({
      conversation: conversation({
        channels: { id: "ch-mail", workspace_id: WS, provider: "resend", platform: "email", late_account_id: null, evolution_instance: null, email_address: "x@x.com", is_active: true },
      }),
    });
    createClient.mockResolvedValue(client);

    const response = await call({
      conversationId: CONV,
      media: { storagePath: `${WS}/${CONV}/out-4.jpg`, kind: "image", mime: "image/jpeg" },
    });

    expect(response.status).toBe(400);
  });
});
