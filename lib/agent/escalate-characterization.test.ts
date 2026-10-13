/**
 * Caracterizacion de `escalateToHuman` (Tareas, F24): lo que hace HOY, fijado antes de que la opcion «crear una tarea
 * cuando derive» le sume algo. Con esa opcion apagada (el default) el comportamiento tiene que ser identico a este.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const mocks = vi.hoisted(() => ({ audit: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: mocks.notify }));

import { escalateToHuman, type EscalateArgs } from "./escalate";

const WS = "ws-1";
const CONV = "conv-1";
const CONTACT = "contact-1";
const AGENT = "agent-1";

const args = (over: Partial<EscalateArgs> = {}): EscalateArgs => ({
  workspaceId: WS, conversationId: CONV, contactId: CONTACT, channelId: "ch-1", agentId: AGENT, runId: "run-1",
  reason: "El lead pidio hablar con una persona", summary: "Quiere precio y fechas", origin: "tool", ...over,
});

function world(conv: Record<string, unknown> = {}) {
  return memoryDb({
    conversations: [{ id: CONV, workspace_id: WS, agent_enabled: true, is_automation_paused: false, status: "closed", assigned_to: "u-assigned", contact_id: CONTACT, ...conv }],
    contacts: [{ id: CONTACT, workspace_id: WS, display_name: "Ana Pérez", instagram_username: "ana", setter_id: "u-setter", vendedor_id: null }],
    tasks: [],
    agents: [{ id: AGENT, workspace_id: WS, guardrails: {} }],
  });
}

beforeEach(() => vi.clearAllMocks());

describe("escalateToHuman: lo que hace hoy (F24, caracterizacion)", () => {
  it("apaga el agente y pausa las automatizaciones en la conversacion", async () => {
    const db = world();
    await escalateToHuman(db.client, args());
    expect(db.rows("conversations")[0]).toMatchObject({ agent_enabled: false, is_automation_paused: true, status: "closed" });
  });

  it("con `reopen`, ademas reabre la conversacion", async () => {
    const db = world();
    await escalateToHuman(db.client, args({ reopen: true }));
    expect(db.rows("conversations")[0].status).toBe("open");
  });

  it("deja el efecto en el audit con el agente como actor, el motivo y el origen", async () => {
    mocks.audit.mockResolvedValue("audit-1");
    const db = world();
    const r = await escalateToHuman(db.client, args());
    expect(r).toEqual({ auditLogId: "audit-1" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WS, entityType: "conversation", entityId: CONV, action: "human_takeover", performedByAgentId: AGENT,
      metadata: expect.objectContaining({ origin: "tool", reason: "El lead pidio hablar con una persona", run_id: "run-1", contact_id: CONTACT, channel_id: "ch-1" }),
    }));
  });

  it("avisa en la campana a la persona asignada, con el nombre del contacto y el resumen", async () => {
    const db = world();
    await escalateToHuman(db.client, args());
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "human_takeover", title: "Ana Pérez necesita una persona", body: "El lead pidio hablar con una persona. Quiere precio y fechas",
      entityType: "conversation", entityId: CONV, recipientId: "u-assigned",
    }));
  });

  it("sin persona asignada, el aviso va a Owner/Admin (recipientId null)", async () => {
    const db = world({ assigned_to: null });
    await escalateToHuman(db.client, args());
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ recipientId: null }));
  });

  it("sin contacto, el aviso dice «Un contacto»; el resumen se recorta a 400 caracteres", async () => {
    const db = world();
    await escalateToHuman(db.client, args({ contactId: null, summary: "x".repeat(900) }));
    const call = mocks.notify.mock.calls[0][0];
    expect(call.title).toBe("Un contacto necesita una persona");
    expect(call.body).toBe(`El lead pidio hablar con una persona. ${"x".repeat(400)}`);
  });

  it("NO crea ninguna tarea (el comportamiento por defecto no cambio)", async () => {
    const db = world();
    await escalateToHuman(db.client, args());
    expect(db.rows("tasks")).toHaveLength(0);
  });

  it("un fallo al pausar la conversacion no impide el audit ni el aviso, y no lanza", async () => {
    const db = world();
    const failing = { ...db.client, from: (t: "conversations" | "contacts") => (t === "conversations" ? { ...db.client.from(t), update: () => ({ eq: async () => ({ error: { message: "caida" } }) }) } : db.client.from(t)) } as never;
    await expect(escalateToHuman(failing, args())).resolves.toBeDefined();
    expect(mocks.audit).toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalled();
  });
});
