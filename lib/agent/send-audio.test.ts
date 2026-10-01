import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "./testing/memory-db";

/**
 * sendAgentAudio (F22): manda un audio de la banca con la autoria del agente.
 *
 * Mismo camino de salida que sendAgentParts (sendChannelMessage), mockeado
 * aca para no depender de Zernio/Evolution de verdad. Lo que importa: la fila
 * en `messages` lleva la transcripcion como texto y el adjunto v2, el
 * audit_log queda con `performed_by_agent_id`, y un fallo de envio no hace
 * explotar nada (ni guarda como si hubiera salido).
 */

const { sendChannelMessage } = vi.hoisted(() => ({ sendChannelMessage: vi.fn() }));
vi.mock("@/lib/flow-engine/send", () => ({ sendChannelMessage }));

import { sendAgentAudio, type AgentAudioToSend } from "./send-audio";
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

const AUDIO: AgentAudioToSend = {
  audioAssetId: "a-1",
  name: "Precio",
  storagePath: `${WS}/library/a-1.m4a`,
  mimeType: "audio/mp4",
  durationSeconds: 8,
  transcript: "Cuesta tanto por mes",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  sendChannelMessage.mockResolvedValue({ ok: true, platformMessageId: "plat-1" });
});

describe("sendAgentAudio: cuando sale bien", () => {
  it("manda por sendChannelMessage con la media y el texto es la transcripcion", async () => {
    const db = world();
    await sendAgentAudio(db.client, ctx(), AUDIO);

    expect(sendChannelMessage).toHaveBeenCalledWith(
      db.client,
      expect.objectContaining({ workspaceId: WS, channelId: "ch-1", conversationId: "cv-1", lateConversationId: "late-1" }),
      expect.objectContaining({
        text: "Cuesta tanto por mes",
        media: expect.objectContaining({ kind: "audio", storagePath: AUDIO.storagePath, mime: "audio/mp4" }),
      }),
    );
  });

  it("guarda la fila con autoria del agente y el adjunto v2 en ready", async () => {
    const db = world();
    const result = await sendAgentAudio(db.client, ctx(), AUDIO);

    expect(result.ok).toBe(true);
    const row = db.rows("messages")[0];
    expect(row).toMatchObject({
      origin: "agent",
      text: "Cuesta tanto por mes",
      sent_by_agent_id: "agent-1",
      agent_run_id: "run-1",
      status: "sent",
    });
    expect(row.attachments).toMatchObject({ v: 2, items: [expect.objectContaining({ kind: "audio", status: "ready" })] });
  });

  it("actualiza last_message_at y last_message_preview de la conversacion", async () => {
    const db = world();
    await sendAgentAudio(db.client, ctx(), AUDIO);
    const conv = db.rows("conversations").find((c) => c.id === "cv-1")!;
    expect(conv.last_message_at).toBeTruthy();
    expect(conv.last_message_preview).toBeTruthy();
  });

  it("deja la entrada en audit_log con el agente como actor", async () => {
    const db = world();
    const result = await sendAgentAudio(db.client, ctx(), AUDIO);
    const entry = db.rows("audit_log")[0];
    expect(entry).toMatchObject({
      workspace_id: WS,
      entity_type: "audio_asset",
      entity_id: "a-1",
      action: "agent_audio_sent",
      performed_by_agent_id: "agent-1",
      performed_by: null,
    });
    expect(result.messageId).toBeTruthy();
  });
});

describe("sendAgentAudio: cuando falla el envio", () => {
  it("no actualiza la conversacion ni audita, pero deja la fila marcada failed", async () => {
    sendChannelMessage.mockResolvedValue({ ok: false, failure: { kind: "unknown", message: "se cayo el canal", retryable: true } });
    const db = world();
    const result = await sendAgentAudio(db.client, ctx(), AUDIO);

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
