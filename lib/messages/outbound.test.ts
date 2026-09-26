import { describe, it, expect } from "vitest";
import {
  outboundMessageRow,
  originConsistencyError,
  OUTBOUND_ORIGINS,
  type OutboundRowInput,
} from "./outbound";

describe("outboundMessageRow", () => {
  it("marca origin y arrastra la autoria del agente", () => {
    const row = outboundMessageRow({
      conversationId: "c1",
      origin: "agent",
      text: "hola",
      status: "sent",
      sentByAgentId: "a1",
      agentRunId: "r1",
      platformMessageId: "pm1",
    });
    expect(row.origin).toBe("agent");
    expect(row.direction).toBe("outbound");
    expect(row.sent_by_agent_id).toBe("a1");
    expect(row.agent_run_id).toBe("r1");
    expect(row.sent_by_user_id).toBeNull();
  });

  it("un borrador aprobado lleva las dos autorias, origin agent", () => {
    const row = outboundMessageRow({
      conversationId: "c1",
      origin: "agent",
      text: "hola",
      status: "sent",
      sentByAgentId: "a1",
      sentByUserId: "u1",
      agentRunId: "r1",
    });
    expect(row.origin).toBe("agent");
    expect(row.sent_by_agent_id).toBe("a1");
    expect(row.sent_by_user_id).toBe("u1");
  });

  it("una respuesta manual es origin user con sent_by_user_id", () => {
    const row = outboundMessageRow({
      conversationId: "c1",
      origin: "user",
      text: "hola",
      status: "sent",
      sentByUserId: "u1",
      platformMessageId: "pm1",
    });
    expect(row.origin).toBe("user");
    expect(row.sent_by_user_id).toBe("u1");
    expect(row.sent_by_agent_id).toBeNull();
  });

  it("un flow lleva sent_by_flow_id y sent_by_node_id", () => {
    const row = outboundMessageRow({
      conversationId: "c1",
      origin: "flow",
      text: "hola",
      status: "sent",
      sentByFlowId: "f1",
      sentByNodeId: "n1",
    });
    expect(row.origin).toBe("flow");
    expect(row.sent_by_flow_id).toBe("f1");
    expect(row.sent_by_node_id).toBe("n1");
  });

  it("un external no lleva ningun autor", () => {
    const row = outboundMessageRow({
      conversationId: "c1",
      origin: "external",
      text: "respuesta de ManyChat",
      status: "delivered",
      platformMessageId: "mid1",
      platformNativeMessageId: "mid1",
    });
    expect(row.origin).toBe("external");
    expect(row.sent_by_agent_id).toBeNull();
    expect(row.sent_by_user_id).toBeNull();
    expect(row.sent_by_flow_id).toBeNull();
    expect(row.agent_run_id).toBeNull();
  });

  it("omite created_at y workspace_id cuando no se pasan (defaults de la base)", () => {
    const row = outboundMessageRow({
      conversationId: "c1",
      origin: "user",
      text: "hola",
      status: "sent",
      sentByUserId: "u1",
    });
    expect("created_at" in row).toBe(false);
    expect("workspace_id" in row).toBe(false);
  });

  it("incluye created_at y workspace_id cuando se pasan", () => {
    const row = outboundMessageRow({
      conversationId: "c1",
      origin: "external",
      text: "x",
      status: "delivered",
      createdAt: "2026-09-01T00:00:00Z",
      workspaceId: "w1",
    });
    expect(row.created_at).toBe("2026-09-01T00:00:00Z");
    expect(row.workspace_id).toBe("w1");
  });
});

describe("originConsistencyError", () => {
  const base: OutboundRowInput = { conversationId: "c1", origin: "external", text: "x", status: "sent" };

  it("acepta cada origin bien formado", () => {
    expect(originConsistencyError({ ...base, origin: "agent", sentByAgentId: "a1" })).toBeNull();
    expect(originConsistencyError({ ...base, origin: "user", sentByUserId: "u1" })).toBeNull();
    expect(originConsistencyError({ ...base, origin: "flow", sentByFlowId: "f1" })).toBeNull();
    expect(originConsistencyError({ ...base, origin: "sequence" })).toBeNull();
    expect(originConsistencyError({ ...base, origin: "broadcast" })).toBeNull();
    expect(originConsistencyError({ ...base, origin: "external" })).toBeNull();
  });

  it("rechaza un external con autor", () => {
    expect(originConsistencyError({ ...base, origin: "external", sentByAgentId: "a1" })).toMatch(/external/);
    expect(originConsistencyError({ ...base, origin: "external", sentByUserId: "u1" })).toMatch(/external/);
  });

  it("rechaza user/agent/flow sin su autor", () => {
    expect(originConsistencyError({ ...base, origin: "user" })).toMatch(/user/);
    expect(originConsistencyError({ ...base, origin: "agent" })).toMatch(/agent/);
    expect(originConsistencyError({ ...base, origin: "flow" })).toMatch(/flow/);
  });

  it("cubre exactamente los 6 origenes", () => {
    expect([...OUTBOUND_ORIGINS].sort()).toEqual(
      ["agent", "broadcast", "external", "flow", "sequence", "user"],
    );
  });
});
