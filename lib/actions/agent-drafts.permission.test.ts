/**
 * Equipo y roles (F20): mandar, descartar o regenerar un borrador del agente pide `inbox.<canal>.reply`
 * del canal de ese borrador.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const platform = vi.hoisted(() => ({ value: "instagram" }));
const keys = vi.hoisted(() => ({ list: [] as string[] }));
const actions = vi.hoisted(() => ({
  approveDraft: vi.fn(async () => ({ ok: true })),
  discardDraft: vi.fn(async () => ({ ok: true })),
  regenerateDraft: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/agent/drafts/actions", () => actions);
vi.mock("@/lib/agent/drafts/queue-query", () => ({ draftOwner: vi.fn(), loadLiveDraft: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ getWorkspace: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  getMemberAction: async () => ({ can: (k: string) => keys.list.includes(k) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({}),
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { channels: { platform: platform.value } } }) }) }) }),
  }),
}));

const { sendDraftAction, discardDraftAction, regenerateDraftAction } = await import("./agent-drafts");

beforeEach(() => {
  vi.clearAllMocks();
  platform.value = "instagram";
  keys.list = [];
});

describe("borradores del agente: responder pide la clave del canal", () => {
  it("sin inbox.instagram.reply, las tres acciones se rechazan y no llegan a la logica", async () => {
    keys.list = ["inbox.instagram.view", "inbox.whatsapp.reply"];
    for (const run of [() => sendDraftAction("d1"), () => discardDraftAction("d1"), () => regenerateDraftAction("d1")]) {
      expect(await run()).toMatchObject({ ok: false, error: "Tu rol no puede responder por este canal." });
    }
    expect(actions.approveDraft).not.toHaveBeenCalled();
    expect(actions.discardDraft).not.toHaveBeenCalled();
    expect(actions.regenerateDraft).not.toHaveBeenCalled();
  });

  it("con inbox.instagram.reply las tres funcionan", async () => {
    keys.list = ["inbox.instagram.reply"];
    expect(await sendDraftAction("d1")).toMatchObject({ ok: true });
    expect(await discardDraftAction("d1")).toMatchObject({ ok: true });
    expect(await regenerateDraftAction("d1")).toMatchObject({ ok: true });
  });

  it("la clave tiene que ser la del canal del borrador", async () => {
    platform.value = "whatsapp";
    keys.list = ["inbox.instagram.reply"];
    expect(await sendDraftAction("d1")).toMatchObject({ ok: false });
    keys.list = ["inbox.whatsapp.reply"];
    expect(await sendDraftAction("d1")).toMatchObject({ ok: true });
  });
});
