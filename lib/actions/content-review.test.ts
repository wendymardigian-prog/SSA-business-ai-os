/**
 * Mandar a revision, aprobar y devolver (F37) — y, desde Contenido v4, que
 * cada una corte la sesion de edicion con su propia version (C6).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const POST = "post-1";
const USER = "user-1";

let db: MemoryDb;
let role = "owner";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: USER },
    workspace: { id: WS, timezone: "UTC" },
    role,
    roleId: null,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/publishing/bootstrap", () => ({ registerPublishing: vi.fn() }));
vi.mock("@/lib/publishing/dispatcher", () => ({ runPublication: vi.fn() }));

const { requestReview, approvePost, returnPost } = await import("./content-review");

function seed(status: string) {
  db = memoryDb({
    content_posts: [{ id: POST, workspace_id: WS, title: "Una pieza", status, created_by: USER }],
    content_post_versions: [],
    notifications: [],
  });
}

beforeEach(() => {
  role = "owner";
  seed("in_production");
});

describe("C6 · cada cambio de estado corta la sesion con su propia version", () => {
  it("mandar a revision deja una version con reason 'status_change'", async () => {
    const result = await requestReview({ postId: POST });

    expect(result.ok).toBe(true);
    const versions = db.rows("content_post_versions");
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ reason: "status_change", author_id: USER });
  });

  it("aprobar deja una version con reason 'approve', distinto de un cambio de estado cualquiera", async () => {
    seed("in_review");

    const result = await approvePost({ postId: POST });

    expect(result.ok).toBe(true);
    const versions = db.rows("content_post_versions");
    expect(versions).toHaveLength(1);
    expect(versions[0].reason).toBe("approve");
  });

  it("devolver deja una version con reason 'status_change'", async () => {
    seed("in_review");

    const result = await returnPost({ postId: POST, comment: "Falta el CTA" });

    expect(result.ok).toBe(true);
    expect(db.rows("content_post_versions")[0].reason).toBe("status_change");
  });

  it("devolver sin encontrar la pieza no escribe ninguna version", async () => {
    const result = await returnPost({ postId: "no-existe", comment: "x" });

    expect(result.ok).toBe(false);
    expect(db.rows("content_post_versions")).toHaveLength(0);
  });
});
