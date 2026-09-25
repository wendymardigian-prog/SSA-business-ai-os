import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDraft, type CreateDraftInput } from "./create";
import { discardPendingDrafts, supersedePendingDrafts } from "./lifecycle";
import { memoryDb } from "../testing/memory-db";
import { oneLiveDraftPerConversation } from "../testing/turn-world";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const world = (drafts: Record<string, unknown>[] = [], channel: Record<string, unknown> = {}) =>
  memoryDb(
    {
      channels: [{ id: "ch-1", platform: "instagram", messaging_window_hours: null, ...channel }],
      messages: [{ id: "in-1", conversation_id: "cv-1", direction: "inbound", created_at: "2026-09-25T10:00:00.000Z" }],
      agent_drafts: drafts,
    },
    { unique: { agent_drafts: oneLiveDraftPerConversation } },
  );

const input = (over: Partial<CreateDraftInput> = {}): CreateDraftInput => ({
  workspaceId: "ws-1",
  agentId: "agent-1",
  conversationId: "cv-1",
  contactId: "c-1",
  channelId: "ch-1",
  runId: "run-1",
  body: "hola",
  bodyParts: ["hola"],
  noReplyReason: null,
  suggestedActions: [],
  appliedActions: [],
  burst: [{ id: "in-1", created_at: "2026-09-25T10:00:00.000Z" }],
  ...over,
});

describe("createDraft", () => {
  it("crea el pendiente con la ventana del canal", async () => {
    const db = world();
    expect(await createDraft(db.client, input())).toMatchObject({ kind: "created" });
    expect(db.rows("agent_drafts")[0]).toMatchObject({ status: "pending", sendable_until: "2026-09-26T10:00:00.000Z" });
  });

  it("canal sin ventana: sendable_until vacio", async () => {
    const db = world([], { messaging_window_hours: 0 });
    await createDraft(db.client, input());
    expect(db.rows("agent_drafts")[0].sendable_until).toBeNull();
  });

  it("reemplaza al pendiente (o fallido) anterior: nunca quedan dos vivos", async () => {
    const db = world([{ id: "d-old", conversation_id: "cv-1", status: "failed", burst_last_inbound_at: "2026-09-25T09:00:00.000Z" }]);
    expect(await createDraft(db.client, input())).toMatchObject({ kind: "created" });
    expect(db.rows("agent_drafts").find((d) => d.id === "d-old")?.status).toBe("superseded");
    expect(db.rows("agent_drafts").filter((d) => ["pending", "sending", "failed"].includes(d.status as string))).toHaveLength(1);
  });

  it("con uno saliendo, no inserta: devuelve blocked_by_in_flight_send", async () => {
    const db = world([{ id: "d-out", conversation_id: "cv-1", status: "sending", burst_last_inbound_at: "2026-09-25T09:00:00.000Z" }]);
    expect(await createDraft(db.client, input())).toEqual({ kind: "blocked_by_in_flight_send" });
    expect(db.rows("agent_drafts")).toHaveLength(1);
  });

  it("dos pendientes en la misma conversacion son imposibles (el indice los rechaza)", async () => {
    const db = world([{ id: "d-1", conversation_id: "cv-1", status: "pending" }]);
    const { error } = await db.client.from("agent_drafts").insert({ conversation_id: "cv-1", status: "pending" } as never);
    expect(error).toMatchObject({ code: "23505" });
  });
});

describe("ciclo de vida", () => {
  const seeded = () =>
    world([
      { id: "p", conversation_id: "cv-1", status: "pending" },
      { id: "s", conversation_id: "cv-2", status: "sending" },
      { id: "f", conversation_id: "cv-3", status: "failed" },
    ]);

  it("un entrante nuevo reemplaza pending y failed, nunca sending", async () => {
    const db = seeded();
    for (const cv of ["cv-1", "cv-2", "cv-3"]) await supersedePendingDrafts(db.client, cv);
    const status = Object.fromEntries(db.rows("agent_drafts").map((d) => [d.id, d.status]));
    expect(status).toEqual({ p: "superseded", s: "sending", f: "superseded" });
  });

  it("una salida real descarta pending y failed, con motivo automatico", async () => {
    const db = seeded();
    await discardPendingDrafts(db.client, "cv-1", { reason: "auto:manual_reply", decidedBy: "u-1" });
    await discardPendingDrafts(db.client, "cv-2", { reason: "auto:manual_reply", decidedBy: "u-1" });
    expect(db.rows("agent_drafts").find((d) => d.id === "p")).toMatchObject({ status: "discarded", discard_reason: "auto:manual_reply", decided_by: "u-1" });
    expect(db.rows("agent_drafts").find((d) => d.id === "s")?.status).toBe("sending");
  });
});
