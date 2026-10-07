/**
 * movePostToColumn escribe una version al cambiar el estado (Contenido v4, C6).
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

const { movePostToColumn } = await import("./content");

beforeEach(() => {
  role = "owner";
  db = memoryDb({
    content_posts: [
      { id: POST, workspace_id: WS, title: "Una pieza", status: "draft", created_by: USER, networks: [] },
    ],
    content_post_versions: [],
  });
});

describe("C6 · mover una tarjeta corta la sesion de edicion", () => {
  it("deja una version con reason 'status_change'", async () => {
    const result = await movePostToColumn(POST, "in_production");

    expect(result.ok).toBe(true);
    const versions = db.rows("content_post_versions");
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ reason: "status_change", author_id: USER });
  });

  it("un movimiento que se rechaza no escribe ninguna version", async () => {
    role = "member";
    db.rows("content_posts")[0].created_by = "otro";

    const result = await movePostToColumn(POST, "in_review");

    expect(result.ok).toBe(false);
    expect(db.rows("content_post_versions")).toHaveLength(0);
  });
});
