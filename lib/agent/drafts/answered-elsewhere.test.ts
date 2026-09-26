import { describe, it, expect, vi, beforeEach } from "vitest";
import { approveDraft } from "./actions";
import { refreshPendingDrafts } from "./refresh-job";
import { discardPendingDrafts } from "./lifecycle";
import { memoryDb } from "../testing/memory-db";
import { oneLiveDraftPerConversation } from "../testing/turn-world";
import type { RefreshFn } from "../refresh";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const NOW = new Date("2026-09-25T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function world(draftStatus = "pending") {
  return memoryDb(
    {
      channels: [{ id: "ch-1", workspace_id: "ws-1", platform: "instagram", messaging_window_hours: null, late_account_id: "acc-1" }],
      conversations: [{ id: "cv-1", workspace_id: "ws-1", channel_id: "ch-1", contact_id: "c-1", late_conversation_id: "lc-1", status: "open", assigned_to: null }],
      contacts: [{ id: "c-1", display_name: "Ana", do_not_contact: false }],
      messages: [{ id: "in-1", conversation_id: "cv-1", direction: "inbound", text: "cuanto sale?", created_at: hoursAgo(2) }],
      agent_runs: [{ id: "run-1", conversation_id: "cv-1", source: "agent", status: "drafted", created_at: hoursAgo(2) }],
      agent_drafts: [
        {
          id: "d-1",
          workspace_id: "ws-1",
          agent_id: "agent-1",
          conversation_id: "cv-1",
          contact_id: "c-1",
          channel_id: "ch-1",
          run_id: "run-1",
          status: draftStatus,
          body: "Sale 500. Te paso el link?",
          body_parts: ["Sale 500. Te paso el link?"],
          suggested_actions: [],
          discard_reason: null,
          decided_by: null,
          decided_at: null,
          burst_last_inbound_at: hoursAgo(2),
        },
      ],
    },
    { now: () => NOW, unique: { agent_drafts: oneLiveDraftPerConversation } },
  );
}

/** Refresco que simula traer una respuesta externa posterior a la ráfaga. */
const refreshBringsExternal: RefreshFn = async (supabase, args) => {
  await supabase.from("messages").insert({
    id: `ext-${Date.now()}`,
    conversation_id: args.conversationId,
    workspace_id: args.workspaceId,
    direction: "outbound",
    origin: "external",
    text: "ya te respondo por acá",
    status: "delivered",
    created_at: hoursAgo(1),
  });
  return { ok: true, inserted: 1, error: null };
};

describe("borrador respondido por otro medio (F6)", () => {
  it("approveDraft refresca primero y frena si apareció una respuesta", async () => {
    const db = world("pending");
    const result = await approveDraft({
      user: db.client,
      service: db.client,
      userId: "u-1",
      draftId: "d-1",
      refresh: refreshBringsExternal,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("answered_elsewhere");
    const draft = db.rows("agent_drafts")[0];
    expect(draft.status).toBe("discarded");
    expect(draft.discard_reason).toBe("auto:answered_elsewhere");
  });

  it("un saliente propio guardado descarta el borrador (auto:manual_reply)", async () => {
    // Simula lo que hace el trigger de la 00077 al guardarse una respuesta manual.
    const db = world("pending");
    await discardPendingDrafts(db.client, "cv-1", { reason: "auto:manual_reply", decidedBy: "u-1", now: NOW });
    const draft = db.rows("agent_drafts")[0];
    expect(draft.status).toBe("discarded");
    expect(draft.discard_reason).toBe("auto:manual_reply");
  });

  it("el job refresca sólo conversaciones con borrador pendiente/fallido", async () => {
    const db = world("pending");
    const calls: string[] = [];
    const spy: RefreshFn = async (supabase, args) => {
      calls.push(args.conversationId);
      return refreshBringsExternal(supabase, args);
    };
    const res = await refreshPendingDrafts(db.client, { refresh: spy });
    expect(calls).toEqual(["cv-1"]);
    expect(res.conversations).toBe(1);
    expect(res.inserted).toBe(1);
  });

  it("el job no refresca si no hay borradores vivos", async () => {
    const db = world("sent");
    const calls: string[] = [];
    const spy: RefreshFn = async (_s, args) => {
      calls.push(args.conversationId);
      return { ok: true, inserted: 0, error: null };
    };
    const res = await refreshPendingDrafts(db.client, { refresh: spy });
    expect(calls).toHaveLength(0);
    expect(res.conversations).toBe(0);
  });

  it("desde failed también se descarta por approveDraft", async () => {
    const db = world("failed");
    const result = await approveDraft({
      user: db.client,
      service: db.client,
      userId: "u-1",
      draftId: "d-1",
      refresh: refreshBringsExternal,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(db.rows("agent_drafts")[0].status).toBe("discarded");
  });
});
