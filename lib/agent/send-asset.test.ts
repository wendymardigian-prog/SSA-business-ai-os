import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "./testing/memory-db";

/**
 * sendAgentAsset: manda un audio de la banca con la autoria del agente.
 *
 * Mismo camino de salida que sendAgentParts (sendChannelMessage), mockeado
 * aca para no depender de Zernio/Evolution de verdad. Lo que importa: copia
 * el archivo a la conversacion ANTES de mandar (nunca el path de biblioteca
 * directo), la fila en `messages` lleva la transcripcion como texto y el
 * adjunto v2, el audit_log queda con `performed_by_agent_id`, y un fallo de
 * envio (o de la copia) no hace explotar nada ni guarda como si hubiera
 * salido.
 */

const { sendChannelMessage, copyAssetToChat } = vi.hoisted(() => ({
  sendChannelMessage: vi.fn(),
  copyAssetToChat: vi.fn(),
}));
vi.mock("@/lib/flow-engine/send", () => ({ sendChannelMessage }));
vi.mock("@/lib/response-assets/send-copy", () => ({ copyAssetToChat }));

import { sendAgentAsset, type AgentAssetToSend } from "./send-asset";
import type { AgentSendContext } from "./send";

const WS = "ws-1";

function world() {
  return memoryDb({
    messages: [],
    conversations: [{ id: "cv-1", workspace_id: WS, last_message_at: null, last_message_preview: null }],
    audit_log: [],
  });
}

function ctx(): AgentSendContext {
  return {
    workspaceId: WS,
    channelId: "ch-1",
    contactId: "c-1",
    conversationId: "cv-1",
    lateConversationId: "late-1",
    agentId: "agent-1",
    runId: "run-1",
  };
}

const ASSET: AgentAssetToSend = {
  assetId: "a-1",
  name: "Precio",
  storagePath: `${WS}/library/a-1.m4a`,
  mimeType: "audio/mp4",
  durationSeconds: 8,
  transcript: "Cuesta tanto por mes",
};

const COPIED_PATH = `${WS}/cv-1/library-copia.m4a`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  sendChannelMessage.mockResolvedValue({ ok: true, platformMessageId: "plat-1" });
  copyAssetToChat.mockResolvedValue({
    ok: true,
    copy: { storagePath: COPIED_PATH, mime: "audio/mp4", filename: "Precio.m4a", durationSeconds: 8 },
  });
});

describe("sendAgentAsset: cuando sale bien", () => {
  it("copia el archivo a la conversacion ANTES de mandar", async () => {
    const db = world();
    await sendAgentAsset(db.client, ctx(), ASSET);

    expect(copyAssetToChat).toHaveBeenCalledWith(db.client, { workspaceId: WS, conversationId: "cv-1", assetId: "a-1" });
  });

  it("manda por sendChannelMessage con el PATH COPIADO, no el de la biblioteca", async () => {
    const db = world();
    await sendAgentAsset(db.client, ctx(), ASSET);

    expect(sendChannelMessage).toHaveBeenCalledWith(
      db.client,
      expect.objectContaining({ workspaceId: WS, channelId: "ch-1", conversationId: "cv-1", lateConversationId: "late-1" }),
      expect.objectContaining({
        text: "Cuesta tanto por mes",
        media: expect.objectContaining({ kind: "audio", storagePath: COPIED_PATH, mime: "audio/mp4" }),
      }),
    );
  });

  it("guarda la fila con autoria del agente, el path copiado y el adjunto v2 en ready", async () => {
    const db = world();
    const result = await sendAgentAsset(db.client, ctx(), ASSET);

    expect(result.ok).toBe(true);
    const row = db.rows("messages")[0];
    expect(row).toMatchObject({
      origin: "agent",
      text: "Cuesta tanto por mes",
      sent_by_agent_id: "agent-1",
      agent_run_id: "run-1",
      status: "sent",
    });
    expect(row.attachments).toMatchObject({
      v: 2,
      items: [expect.objectContaining({ kind: "audio", status: "ready", storagePath: COPIED_PATH })],
    });
  });

  it("actualiza last_message_at y last_message_preview de la conversacion", async () => {
    const db = world();
    await sendAgentAsset(db.client, ctx(), ASSET);
    const conv = db.rows("conversations").find((c) => c.id === "cv-1")!;
    expect(conv.last_message_at).toBeTruthy();
    expect(conv.last_message_preview).toBeTruthy();
  });

  it("deja la entrada en audit_log con el agente como actor", async () => {
    const db = world();
    const result = await sendAgentAsset(db.client, ctx(), ASSET);
    const entry = db.rows("audit_log")[0];
    expect(entry).toMatchObject({
      workspace_id: WS,
      entity_type: "response_asset",
      entity_id: "a-1",
      action: "agent_asset_sent",
      performed_by_agent_id: "agent-1",
      performed_by: null,
    });
    expect(result.messageId).toBeTruthy();
  });
});

describe("sendAgentAsset: cuando falla el envio", () => {
  it("no actualiza la conversacion ni audita, pero deja la fila marcada failed", async () => {
    sendChannelMessage.mockResolvedValue({ ok: false, failure: { kind: "unknown", message: "se cayo el canal", retryable: true } });
    const db = world();
    const result = await sendAgentAsset(db.client, ctx(), ASSET);

    expect(result.ok).toBe(false);
    expect(result.failure?.message).toBe("se cayo el canal");
    const row = db.rows("messages")[0];
    expect(row.status).toBe("failed");
    expect(row.text).toBe("se cayo el canal");
    expect(db.rows("audit_log")).toHaveLength(0);
    const conv = db.rows("conversations").find((c) => c.id === "cv-1")!;
    expect(conv.last_message_at).toBeNull();
  });
});

describe("sendAgentAsset: cuando falla la copia", () => {
  it("no manda nada ni guarda una fila: el audio ya no esta disponible", async () => {
    copyAssetToChat.mockResolvedValue({ ok: false, error: "Ese audio ya no está disponible" });
    const db = world();
    const result = await sendAgentAsset(db.client, ctx(), ASSET);

    expect(result).toEqual({ ok: false, messageId: null, failure: { kind: "unknown", message: "Ese audio ya no está disponible", retryable: true } });
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(db.rows("messages")).toHaveLength(0);
    expect(db.rows("audit_log")).toHaveLength(0);
  });
});
