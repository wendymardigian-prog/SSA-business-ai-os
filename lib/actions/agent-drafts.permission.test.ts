/**
 * Mandar, descartar o regenerar un borrador del agente pide "puede responder" en la CUENTA de ese
 * borrador (00249).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const draftChannel = vi.hoisted(() => ({ id: "ch-ig-1" }));
const bandeja = vi.hoisted(() => ({ channels: { mode: "custom", byChannel: {} } as unknown }));
const actions = vi.hoisted(() => ({
  approveDraft: vi.fn(async () => ({ ok: true })),
  discardDraft: vi.fn(async () => ({ ok: true })),
  regenerateDraft: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/agent/drafts/actions", () => actions);
vi.mock("@/lib/agent/drafts/queue-query", () => ({ draftOwner: vi.fn(), loadLiveDraft: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ getWorkspace: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  getMemberAction: async () => ({ permissions: { channels: bandeja.channels } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({}),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { channel_id: draftChannel.id } }) }) }) }),
  }),
}));

const { sendDraftAction, discardDraftAction, regenerateDraftAction } = await import("./agent-drafts");

const custom = (byChannel: Record<string, { scope: string; reply: boolean }>) => ({ mode: "custom", byChannel });

beforeEach(() => {
  vi.clearAllMocks();
  draftChannel.id = "ch-ig-1";
  bandeja.channels = custom({});
});

describe("borradores del agente: responder pide «responde» en la cuenta del borrador", () => {
  it("viendo la cuenta sin responder, las tres acciones se rechazan y no llegan a la logica", async () => {
    bandeja.channels = custom({ "ch-ig-1": { scope: "all", reply: false }, "ch-wa": { scope: "all", reply: true } });
    for (const run of [() => sendDraftAction("d1"), () => discardDraftAction("d1"), () => regenerateDraftAction("d1")]) {
      expect(await run()).toMatchObject({ ok: false, error: "Tu rol no puede responder por esta cuenta." });
    }
    expect(actions.approveDraft).not.toHaveBeenCalled();
    expect(actions.discardDraft).not.toHaveBeenCalled();
    expect(actions.regenerateDraft).not.toHaveBeenCalled();
  });

  it("con «responde» en esa cuenta las tres funcionan", async () => {
    bandeja.channels = custom({ "ch-ig-1": { scope: "own", reply: true } });
    expect(await sendDraftAction("d1")).toMatchObject({ ok: true });
    expect(await discardDraftAction("d1")).toMatchObject({ ok: true });
    expect(await regenerateDraftAction("d1")).toMatchObject({ ok: true });
  });

  it("tiene que ser la cuenta del borrador: el otro Instagram no alcanza", async () => {
    draftChannel.id = "ch-ig-2";
    bandeja.channels = custom({ "ch-ig-1": { scope: "all", reply: true } });
    expect(await sendDraftAction("d1")).toMatchObject({ ok: false });
    bandeja.channels = { mode: "all", all: { scope: "own", reply: true } };
    expect(await sendDraftAction("d1")).toMatchObject({ ok: true });
  });
});
