/**
 * «Enviar encuesta» a un grupo de WhatsApp. Evolution simulado: nada sale de verdad.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import type { FlowExecutionContext } from "../types";

const sendPoll = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ id: "POLL-WA" })));
vi.mock("@/lib/evolution-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/evolution-client")>("@/lib/evolution-client");
  return { ...actual, sendPoll };
});
vi.mock("@/lib/evolution-config", () => ({ getEvolutionConfig: vi.fn(async () => ({ baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "t" })) }));

const { sendPollNode } = await import("./send-poll");

const WS = "ws-1";
const JID = "120363001122334455@g.us";
let db: MemoryDb;
let allow = true;
let skipped: string[] = [];

function world(group: Record<string, unknown> = {}) {
  allow = true;
  return memoryDb(
    {
      whatsapp_groups: [{ id: "g-1", workspace_id: WS, channel_id: "ch-wa", group_jid: JID, subject: "Comunidad", in_inbox: true, save_contacts: false, left_at: null, ...group }],
      channels: [{ id: "ch-wa", workspace_id: WS, provider: "evolution", platform: "whatsapp", evolution_instance: "inst-1", is_active: true }],
      whatsapp_group_messages: [],
      flow_send_claims: [],
      analytics_events: [],
    },
    {
      unique: { flow_send_claims: (a, b) => a.session_id === b.session_id && a.node_id === b.node_id && a.target === b.target },
      rpc: { claim_automated_send: () => allow },
    },
  );
}

const ctx = (): FlowExecutionContext => ({
  triggerId: "t",
  flowId: "flow-1",
  channelId: "",
  contactId: "c-1",
  conversationId: "",
  workspaceId: WS,
  incomingMessage: {},
  variables: { contact: { first_name: "Ana" } },
  onStepSkipped: (s) => skipped.push(s.label),
});

const run = (data: Record<string, unknown>, sessionId = "sess-1") =>
  sendPollNode.execute({ supabase: db.client as never, data, context: ctx(), node: { id: "n-poll", type: "action", data } as never, sessionId } as never);

beforeEach(() => {
  vi.clearAllMocks();
  skipped = [];
});

describe("Enviar encuesta", () => {
  it("manda la encuesta al grupo y la deja en su hilo con el flujo y el paso", async () => {
    db = world();
    await run({ groupId: "g-1", question: "¿Venís, {{contact.first_name}}?", options: ["Sí", "No", ""], multiple: false });
    expect(sendPoll).toHaveBeenCalledWith(expect.anything(), "inst-1", JID, { name: "¿Venís, Ana?", values: ["Sí", "No"], selectableCount: 1 });
    expect(db.rows("whatsapp_group_messages")[0]).toMatchObject({
      platform_message_id: "POLL-WA",
      direction: "outbound",
      origin: "flow",
      status: "sent",
      sent_by_flow_id: "flow-1",
      sent_by_node_id: "n-poll",
      poll: { name: "¿Venís, Ana?", options: ["Sí", "No"], selectableCount: 1 },
    });
    expect(skipped).toEqual([]);
  });

  it("la misma ejecucion no la manda dos veces", async () => {
    db = world();
    await run({ groupId: "g-1", question: "X", options: ["a", "b"] });
    await run({ groupId: "g-1", question: "X", options: ["a", "b"] });
    expect(sendPoll).toHaveBeenCalledTimes(1);
    expect(skipped).toEqual(["Enviar encuesta"]);
  });

  it("se saltea sin grupo, con una sola opcion, con el grupo apagado o con el tope de la hora", async () => {
    db = world();
    await run({ question: "X", options: ["a", "b"] });
    await run({ groupId: "g-1", question: "X", options: ["a"] }, "s2");
    db = world({ in_inbox: false, save_contacts: false });
    await run({ groupId: "g-1", question: "X", options: ["a", "b"] }, "s3");
    db = world();
    allow = false;
    await run({ groupId: "g-1", question: "X", options: ["a", "b"] }, "s4");
    expect(sendPoll).not.toHaveBeenCalled();
    expect(skipped).toHaveLength(4);
  });

  it("si WhatsApp la rechaza, queda en el hilo como fallida y el flujo sigue", async () => {
    db = world();
    sendPoll.mockRejectedValueOnce(new Error("Evolution 400"));
    await expect(run({ groupId: "g-1", question: "X", options: ["a", "b"] })).resolves.toBeUndefined();
    expect(db.rows("whatsapp_group_messages")[0]).toMatchObject({ status: "failed", platform_message_id: null });
  });

  it("no necesita contacto", () => {
    expect(sendPollNode.needsContact).toBe(false);
    expect(sendPollNode.requires).toEqual(["whatsapp_channel"]);
  });
});
