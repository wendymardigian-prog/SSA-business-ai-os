/**
 * «Enviar al grupo» e «Invitar a un grupo» (00344). Evolution simulado: nada sale de verdad.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import type { FlowExecutionContext } from "../types";

const sendText = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ id: "TXT-WA" })));
const updateGroupParticipants = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => [{ jid: "x", status: "ok" }] as Array<{ jid: string; status: string }>));
const fetchGroupInviteLink = vi.hoisted(() => vi.fn(async () => "https://chat.whatsapp.com/Abc123"));
const sendEvolutionDirect = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ ok: true })));
vi.mock("@/lib/evolution-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/evolution-client")>("@/lib/evolution-client");
  return { ...actual, sendText, updateGroupParticipants, fetchGroupInviteLink };
});
vi.mock("@/lib/evolution-config", () => ({ getEvolutionConfig: vi.fn(async () => ({ baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "t" })) }));
vi.mock("../send", () => ({ sendEvolutionDirect }));

const { sendToGroupNode } = await import("./send-to-group");
const { inviteToGroupNode } = await import("./invite-to-group");

const WS = "ws-1";
const JID = "120363001122334455@g.us";
let db: MemoryDb;
let allow = true;
let skipped: string[] = [];

function world(group: Record<string, unknown> = {}, contact: Record<string, unknown> = {}) {
  allow = true;
  return memoryDb(
    {
      whatsapp_groups: [
        { id: "g-1", workspace_id: WS, channel_id: "ch-wa", group_jid: JID, subject: "Clase", in_inbox: true, save_contacts: false, left_at: null, announce: false, number_is_admin: true, ...group },
      ],
      channels: [{ id: "ch-wa", workspace_id: WS, provider: "evolution", platform: "whatsapp", evolution_instance: "inst-1", is_active: true }],
      contacts: [{ id: "c-1", workspace_id: WS, phone: "+5491122334455", whatsapp_phone: null, do_not_contact: false, ...contact }],
      response_assets: [{ id: "a-1", workspace_id: WS, kind: "link", content: "Mirá esto", url: "https://ejemplo.test", is_active: true, deleted_at: null }],
      whatsapp_group_messages: [],
      flow_send_claims: [],
      analytics_events: [],
      channel_send_lanes: [],
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
  variables: { workspace: { name: "SSA" } },
  onStepSkipped: (s) => skipped.push(s.label),
});

const send = (data: Record<string, unknown>, sessionId = "sess-1") =>
  sendToGroupNode.execute({ supabase: db.client as never, data, context: ctx(), node: { id: "n-send", type: "action", data } as never, sessionId } as never);
const invite = (data: Record<string, unknown>, sessionId = "sess-1") =>
  inviteToGroupNode.execute({ supabase: db.client as never, data, context: ctx(), node: { id: "n-inv", type: "action", data } as never, sessionId } as never);

beforeEach(() => {
  vi.clearAllMocks();
  skipped = [];
});

describe("Enviar al grupo", () => {
  it("manda el texto con variables y el enlace del recurso, y lo deja en el hilo", async () => {
    db = world();
    await send({ groupId: "g-1", text: "Hola de {{workspace.name}}", assetId: "a-1" });
    expect(sendText).toHaveBeenCalledWith(expect.anything(), "inst-1", JID, "Hola de SSA\n\nMirá esto\nhttps://ejemplo.test");
    expect(db.rows("whatsapp_group_messages")[0]).toMatchObject({ origin: "flow", status: "sent", sent_by_node_id: "n-send" });
    expect(skipped).toEqual([]);
  });

  it("no manda dos veces en la misma ejecucion", async () => {
    db = world();
    await send({ groupId: "g-1", text: "x" });
    await send({ groupId: "g-1", text: "x" });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("se saltea sin grupo, vacio, si solo escriben admins y el numero no es admin, o con el tope", async () => {
    db = world();
    await send({ text: "x" });
    await send({ groupId: "g-1" }, "s2");
    db = world({ announce: true, number_is_admin: false });
    await send({ groupId: "g-1", text: "x" }, "s3");
    db = world();
    allow = false;
    await send({ groupId: "g-1", text: "x" }, "s4");
    expect(sendText).not.toHaveBeenCalled();
    expect(skipped).toHaveLength(4);
  });
});

describe("Invitar a un grupo", () => {
  it("lo suma al grupo si WhatsApp deja, sin mandarle nada", async () => {
    db = world();
    await invite({ groupId: "g-1" });
    expect(updateGroupParticipants).toHaveBeenCalledWith(expect.anything(), "inst-1", JID, "add", ["+5491122334455"]);
    expect(sendEvolutionDirect).not.toHaveBeenCalled();
  });

  it("si su privacidad no deja, le manda el link por privado", async () => {
    db = world();
    updateGroupParticipants.mockResolvedValueOnce([{ jid: "x", status: "needs_invite" }]);
    await invite({ groupId: "g-1" });
    expect(sendEvolutionDirect).toHaveBeenCalledWith(expect.anything(), expect.anything(), "inst-1", "+5491122334455", { text: expect.stringContaining("https://chat.whatsapp.com/Abc123") }, expect.anything());
  });

  it("solo el link, sin intentar agregar", async () => {
    db = world();
    await invite({ groupId: "g-1", linkOnly: true });
    expect(updateGroupParticipants).not.toHaveBeenCalled();
    expect(sendEvolutionDirect).toHaveBeenCalledTimes(1);
  });

  it("respeta no contactar, sin telefono y numero no admin", async () => {
    db = world({}, { do_not_contact: true });
    await invite({ groupId: "g-1" });
    db = world({}, { phone: null });
    await invite({ groupId: "g-1" }, "s2");
    db = world({ number_is_admin: false });
    await invite({ groupId: "g-1" }, "s3");
    expect(updateGroupParticipants).not.toHaveBeenCalled();
    expect(sendEvolutionDirect).not.toHaveBeenCalled();
    expect(skipped).toHaveLength(3);
  });
});
