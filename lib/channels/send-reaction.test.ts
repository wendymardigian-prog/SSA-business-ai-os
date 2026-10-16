import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { evolutionSendReaction, getEvolutionConfig, getZernioApiKey, addMessageReaction, removeMessageReaction, FakeEvolutionError } = vi.hoisted(() => {
  class FakeEvolutionError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    evolutionSendReaction: vi.fn(),
    getEvolutionConfig: vi.fn(),
    getZernioApiKey: vi.fn(),
    addMessageReaction: vi.fn(),
    removeMessageReaction: vi.fn(),
    FakeEvolutionError,
  };
});
vi.mock("@/lib/evolution-client", () => ({ sendReaction: evolutionSendReaction, EvolutionError: FakeEvolutionError }));
vi.mock("@/lib/evolution-config", () => ({ getEvolutionConfig }));
vi.mock("@/lib/integrations/zernio-key", () => ({ getZernioApiKey }));
vi.mock("@/lib/zernio-client", () => ({
  createZernioClient: () => ({ messages: { addMessageReaction, removeMessageReaction } }),
}));

import { sendReactionToProvider, zernioMessageIds, type ReactionTarget } from "./send-reaction";

const WS = "ws-1";

function world(channel: Record<string, unknown> = {}) {
  const memory = memoryDb({
    channels: [
      { id: "ch-wa", workspace_id: WS, provider: "evolution", platform: "whatsapp", late_account_id: "evolution:x", evolution_instance: "ssa-x", is_active: true, ...channel },
      { id: "ch-ig", workspace_id: WS, provider: "zernio", platform: "instagram", late_account_id: "acc-1", evolution_instance: null, is_active: true },
      { id: "ch-em", workspace_id: WS, provider: "resend", platform: "email", late_account_id: "email:a@b.com", evolution_instance: null, is_active: true },
    ],
    contact_channels: [{ channel_id: "ch-wa", contact_id: "c-1", platform_sender_id: "+5491122223333" }],
  });
  return memory.client;
}

const target = (over: Partial<ReactionTarget> = {}): ReactionTarget => ({
  workspaceId: WS,
  channelId: "ch-wa",
  contactId: "c-1",
  lateConversationId: null,
  direction: "inbound",
  platformMessageId: "WAID1",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getEvolutionConfig.mockResolvedValue({ baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "ssa" });
  getZernioApiKey.mockResolvedValue("zk");
  evolutionSendReaction.mockResolvedValue(undefined);
  addMessageReaction.mockResolvedValue({ data: { success: true } });
  removeMessageReaction.mockResolvedValue({ data: { success: true } });
});

describe("reaccionar por WhatsApp (Evolution)", () => {
  it("manda la reaccion al numero del contacto, sobre el mensaje del contacto", async () => {
    const db = world();
    const result = await sendReactionToProvider({ supabase: db, secrets: db, target: target(), emoji: "👍" });
    expect(result).toEqual({ ok: true });
    expect(evolutionSendReaction).toHaveBeenCalledWith(expect.anything(), "ssa-x", { to: "+5491122223333", messageId: "WAID1", fromMe: false, reaction: "👍" });
  });

  it("emoji vacio quita la reaccion", async () => {
    const db = world();
    await sendReactionToProvider({ supabase: db, secrets: db, target: target(), emoji: "" });
    expect(evolutionSendReaction).toHaveBeenCalledWith(expect.anything(), "ssa-x", expect.objectContaining({ reaction: "" }));
  });

  it("un 404 de WhatsApp se explica (mensaje viejo o borrado)", async () => {
    evolutionSendReaction.mockRejectedValueOnce(new FakeEvolutionError("no", 404));
    const db = world();
    const result = await sendReactionToProvider({ supabase: db, secrets: db, target: target(), emoji: "👍" });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/no encontró ese mensaje/i), retryable: false });
  });

  it("otro error de WhatsApp es reintentable y no filtra datos", async () => {
    evolutionSendReaction.mockRejectedValueOnce(new FakeEvolutionError("5491122223333 exploto", 500));
    const db = world();
    const result = await sendReactionToProvider({ supabase: db, secrets: db, target: target(), emoji: "👍" });
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(JSON.stringify(result)).not.toContain("5491122223333");
  });

  it("sin numero vinculado no intenta nada", async () => {
    const db = world();
    const result = await sendReactionToProvider({ supabase: db, secrets: db, target: target({ contactId: "otro" }), emoji: "👍" });
    expect(result).toMatchObject({ ok: false });
    expect(evolutionSendReaction).not.toHaveBeenCalled();
  });

  it("con el canal desconectado no intenta nada", async () => {
    const db = world({ is_active: false });
    const result = await sendReactionToProvider({ supabase: db, secrets: db, target: target(), emoji: "👍" });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/desconectado/i) });
    expect(evolutionSendReaction).not.toHaveBeenCalled();
  });
});

describe("reaccionar por Instagram (Zernio)", () => {
  const ig = (over: Partial<ReactionTarget> = {}) => target({ channelId: "ch-ig", lateConversationId: "zconv-1", platformMessageId: "zid", platformNativeMessageId: "native", ...over });

  it("solo el corazon; otro emoji se rechaza sin llamar a Zernio", async () => {
    const db = world();
    expect(await sendReactionToProvider({ supabase: db, secrets: db, target: ig(), emoji: "🔥" })).toMatchObject({ ok: false });
    expect(addMessageReaction).not.toHaveBeenCalled();
    expect(await sendReactionToProvider({ supabase: db, secrets: db, target: ig(), emoji: "❤️" })).toEqual({ ok: true });
    expect(addMessageReaction).toHaveBeenCalledWith({ path: { conversationId: "zconv-1", messageId: "native" }, body: { accountId: "acc-1", emoji: "❤️" } });
  });

  it("si Zernio no encuentra el id nativo (404) prueba con el suyo", async () => {
    addMessageReaction.mockRejectedValueOnce({ statusCode: 404 }).mockResolvedValueOnce({ data: {} });
    const db = world();
    const result = await sendReactionToProvider({ supabase: db, secrets: db, target: ig(), emoji: "❤️" });
    expect(result).toEqual({ ok: true });
    expect(addMessageReaction).toHaveBeenCalledTimes(2);
    expect(addMessageReaction.mock.calls[1][0].path.messageId).toBe("zid");
  });

  it("si los dos dan 404, lo explica", async () => {
    addMessageReaction.mockRejectedValue({ statusCode: 404 });
    const db = world();
    const result = await sendReactionToProvider({ supabase: db, secrets: db, target: ig(), emoji: "❤️" });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/no encontró ese mensaje/i) });
  });

  it("un error que no es 404 no prueba el otro id", async () => {
    addMessageReaction.mockRejectedValue({ statusCode: 500 });
    const db = world();
    await sendReactionToProvider({ supabase: db, secrets: db, target: ig(), emoji: "❤️" });
    expect(addMessageReaction).toHaveBeenCalledTimes(1);
  });

  it("quitar usa removeMessageReaction con la cuenta", async () => {
    const db = world();
    await sendReactionToProvider({ supabase: db, secrets: db, target: ig(), emoji: "" });
    expect(removeMessageReaction).toHaveBeenCalledWith({ path: { conversationId: "zconv-1", messageId: "native" }, query: { accountId: "acc-1" } });
  });

  it("sin la clave de Zernio, lo dice", async () => {
    getZernioApiKey.mockResolvedValue(null);
    const db = world();
    expect(await sendReactionToProvider({ supabase: db, secrets: db, target: ig(), emoji: "❤️" })).toMatchObject({ ok: false, message: expect.stringMatching(/no está conectada/i) });
  });

  it("sin conversacion de Zernio no se puede", async () => {
    const db = world();
    expect(await sendReactionToProvider({ supabase: db, secrets: db, target: ig({ lateConversationId: null }), emoji: "❤️" })).toMatchObject({ ok: false });
  });
});

describe("lo que nunca se manda", () => {
  it("por email no hay reacciones", async () => {
    const db = world();
    const result = await sendReactionToProvider({ supabase: db, secrets: db, target: target({ channelId: "ch-em" }), emoji: "👍" });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/email/i) });
    expect(evolutionSendReaction).not.toHaveBeenCalled();
    expect(addMessageReaction).not.toHaveBeenCalled();
  });

  it("a un mensaje nuestro no se reacciona", async () => {
    const db = world();
    expect(await sendReactionToProvider({ supabase: db, secrets: db, target: target({ direction: "outbound" }), emoji: "👍" })).toMatchObject({ ok: false });
    expect(evolutionSendReaction).not.toHaveBeenCalled();
  });

  it("sin id del proveedor no hay a que reaccionar", async () => {
    const db = world();
    expect(await sendReactionToProvider({ supabase: db, secrets: db, target: target({ platformMessageId: null }), emoji: "👍" })).toMatchObject({ ok: false });
  });

  it("un canal de otro workspace no se usa", async () => {
    const db = world();
    expect(await sendReactionToProvider({ supabase: db, secrets: db, target: target({ workspaceId: "otro" }), emoji: "👍" })).toMatchObject({ ok: false });
    expect(evolutionSendReaction).not.toHaveBeenCalled();
  });
});

describe("zernioMessageIds", () => {
  it("el nativo primero, sin repetir ni vacios", () => {
    expect(zernioMessageIds({ platformMessageId: "a", platformNativeMessageId: "b" })).toEqual(["b", "a"]);
    expect(zernioMessageIds({ platformMessageId: "a", platformNativeMessageId: "a" })).toEqual(["a"]);
    expect(zernioMessageIds({ platformMessageId: "a", platformNativeMessageId: null })).toEqual(["a"]);
    expect(zernioMessageIds({ platformMessageId: null })).toEqual([]);
  });
});
