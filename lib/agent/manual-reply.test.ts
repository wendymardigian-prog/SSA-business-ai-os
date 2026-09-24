import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyManualReply } from "./manual-reply";
import { memoryDb } from "./testing/memory-db";

/**
 * Una persona respondio a mano: el agente queda FORZADO APAGADO (false), nunca
 * "heredar". Si una persona tomo la conversacion, el agente no vuelve solo.
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function world(agentEnabled: boolean | null, lastError: string | null = null) {
  return memoryDb({
    conversations: [{ id: "cv-1", workspace_id: "ws-1", agent_enabled: agentEnabled, last_agent_error_at: lastError, last_agent_error_run_id: null }],
    audit_log: [],
  });
}

const args = { conversationId: "cv-1", workspaceId: "ws-1", userId: "user-1" };

describe("applyManualReply con el interruptor de tres estados", () => {
  it("en heredar (el default): pasa a forzado apagado y lo audita con old null", async () => {
    const db = world(null);
    await applyManualReply(db.client, args);
    expect(db.rows("conversations")[0].agent_enabled).toBe(false);
    expect(db.rows("audit_log")[0]).toMatchObject({
      action: "agent_toggled",
      changes: { agent_enabled: { old: null, new: false } },
      performed_by: "user-1",
    });
  });

  it("en forzado prendido: pasa a forzado apagado y lo audita con old true", async () => {
    const db = world(true);
    await applyManualReply(db.client, args);
    expect(db.rows("conversations")[0].agent_enabled).toBe(false);
    expect(db.rows("audit_log")[0].changes).toEqual({ agent_enabled: { old: true, new: false } });
  });

  it("ya forzado apagado y sin marca de error: no toca nada ni audita", async () => {
    const db = world(false);
    await applyManualReply(db.client, args);
    expect(db.rows("audit_log")).toHaveLength(0);
  });

  it("ya forzado apagado pero con marca de error: borra la marca sin auditar un cambio que no hubo", async () => {
    const db = world(false, "2026-09-24T10:00:00Z");
    await applyManualReply(db.client, args);
    expect(db.rows("conversations")[0].last_agent_error_at).toBeNull();
    expect(db.rows("audit_log")).toHaveLength(0);
  });
});
