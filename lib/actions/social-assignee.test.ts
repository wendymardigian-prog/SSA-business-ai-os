import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";
const POST = "55555555-5555-4555-8555-555555555555";
const POST_WITH_PIECE = "66666666-6666-4666-8666-666666666666";
const POST_OTHER_WS = "77777777-7777-4777-8777-777777777777";

let db: MemoryDb;
let allowed = true;
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({
  ...(await orig<typeof import("@/lib/audit")>()),
  logAudit: vi.fn(async (a: Record<string, unknown>) => {
    audits.push(a);
    return "a";
  }),
}));
vi.mock("@/lib/workspace-members", () => ({
  getWorkspaceMembers: async () => [{ userId: USER }, { userId: OTHER }],
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
const permission = vi.fn(async (key: string) =>
  allowed ? { supabase: db.client, user: { id: USER }, workspace: { id: WS }, _key: key } : null,
);
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: (key: string) => permission(key) }));

const { setSocialPostAssignee } = await import("./social-assignee");

beforeEach(() => {
  audits.length = 0;
  allowed = true;
  permission.mockClear();
  db = memoryDb({
    social_posts: [
      { id: POST, workspace_id: WS, content_post_id: null, assigned_to: null, deleted_at: null },
      { id: POST_WITH_PIECE, workspace_id: WS, content_post_id: "piece-1", assigned_to: null, deleted_at: null },
      { id: POST_OTHER_WS, workspace_id: "99999999-9999-4999-8999-999999999999", content_post_id: null, assigned_to: null, deleted_at: null },
    ],
  });
});

describe("setSocialPostAssignee", () => {
  it("pide content.publish y sin ese permiso no escribe nada", async () => {
    allowed = false;
    const r = await setSocialPostAssignee(POST, OTHER);
    expect(permission).toHaveBeenCalledWith("content.publish");
    expect(r.ok).toBe(false);
    expect(db.rows("social_posts").find((p) => p.id === POST)?.assigned_to).toBeNull();
    expect(audits).toHaveLength(0);
  });

  it("asigna a un miembro y deja el historial con el antes y el después", async () => {
    const r = await setSocialPostAssignee(POST, OTHER);
    expect(r).toEqual({ ok: true, assignedTo: OTHER });
    expect(db.rows("social_posts").find((p) => p.id === POST)?.assigned_to).toBe(OTHER);
    expect(audits[0]).toMatchObject({
      workspaceId: WS,
      entityType: "social_post",
      entityId: POST,
      action: "social_post.assignee_changed",
      changes: { assigned_to: { old: null, new: OTHER } },
      performedBy: USER,
    });
  });

  it("quita el responsable con null", async () => {
    await setSocialPostAssignee(POST, OTHER);
    const r = await setSocialPostAssignee(POST, null);
    expect(r).toEqual({ ok: true, assignedTo: null });
    expect(db.rows("social_posts").find((p) => p.id === POST)?.assigned_to).toBeNull();
    expect(audits).toHaveLength(2);
  });

  it("no hace nada (ni audita) si no cambia", async () => {
    const r = await setSocialPostAssignee(POST, null);
    expect(r).toEqual({ ok: true, assignedTo: null });
    expect(audits).toHaveLength(0);
  });

  it("rechaza a alguien que no es del equipo", async () => {
    const r = await setSocialPostAssignee(POST, STRANGER);
    expect(r.ok).toBe(false);
    expect(db.rows("social_posts").find((p) => p.id === POST)?.assigned_to).toBeNull();
  });

  it("rechaza una publicación con pieza: ahí manda el responsable de la pieza", async () => {
    const r = await setSocialPostAssignee(POST_WITH_PIECE, OTHER);
    expect(r.ok).toBe(false);
    expect(db.rows("social_posts").find((p) => p.id === POST_WITH_PIECE)?.assigned_to).toBeNull();
  });

  it("no toca publicaciones de otro workspace", async () => {
    const r = await setSocialPostAssignee(POST_OTHER_WS, OTHER);
    expect(r.ok).toBe(false);
    expect(db.rows("social_posts").find((p) => p.id === POST_OTHER_WS)?.assigned_to).toBeNull();
  });

  it("rechaza ids que no son uuid", async () => {
    expect((await setSocialPostAssignee("nada", OTHER)).ok).toBe(false);
    expect((await setSocialPostAssignee(POST, "no-es-uuid")).ok).toBe(false);
  });
});
