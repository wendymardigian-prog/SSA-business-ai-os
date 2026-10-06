/**
 * F78: aprobar y producir copy se deciden por permiso, no por cargo.
 *
 * El rol personalizado "Content Manager" de produccion tiene `content.approve`,
 * `content.publish` y `content.ai`, y hasta F78 no podia aprobar porque el
 * guard miraba si era Owner o Admin. Estos casos fijan las dos puntas: el
 * permiso habilita, y su falta rechaza ANTES de tocar nada.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const USER = "user-1";

let db: MemoryDb;
let role = "member";
let roleId: string | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: USER },
    workspace: { id: WS, timezone: "America/Costa_Rica" },
    role,
    roleId,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
// La cola de copy tiene su propio test: aca solo importa si se pide o no.
const enqueueCopy = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/content/copy-queue", () => ({ enqueueCopy }));

const { approveIdea, discardIdea } = await import("./content");
const { approvePost } = await import("./content-review");

/** Un rol personalizado con exactamente estas claves. */
function customRole(keys: string[]) {
  role = "member";
  roleId = "rol-1";
  db.rows("workspace_roles").push({
    id: "rol-1",
    workspace_id: WS,
    system_role: null,
    permissions: { keys, scopes: { leads: "all", conversations: "all" } },
  });
}

beforeEach(() => {
  role = "member";
  roleId = null;
  enqueueCopy.mockClear();
  db = memoryDb(
    {
      content_ideas: [{ id: "idea-1", workspace_id: WS, title: "Una idea", status: "nueva", format: "Reel" }],
      content_posts: [{ id: "post-1", workspace_id: WS, title: "Una pieza", status: "in_review", created_by: "otro" }],
      workspace_roles: [],
      agents: [],
    },
    { rpc: { approve_content_idea: () => "post-nuevo" } },
  );
});

describe("aprobar una pieza (F78)", () => {
  it("un rol personalizado con content.approve SI aprueba", async () => {
    customRole(["content.view", "content.create", "content.approve"]);

    const result = await approvePost({ postId: "post-1" });

    expect(result).toEqual({ ok: true, status: "approved" });
    expect(db.rows("content_posts")[0].status).toBe("approved");
  });

  it("un Member comun no aprueba, y la pieza queda como estaba", async () => {
    const result = await approvePost({ postId: "post-1" });

    expect(result.ok).toBe(false);
    expect(db.rows("content_posts")[0].status).toBe("in_review");
  });

  it("content.publish solo NO alcanza para aprobar", async () => {
    // Antes bastaba `approve || publish` para algunas cosas: son dos permisos.
    customRole(["content.view", "content.create", "content.publish"]);

    const result = await approvePost({ postId: "post-1" });

    expect(result.ok).toBe(false);
  });

  it("Owner y Admin siguen pudiendo", async () => {
    role = "owner";

    const result = await approvePost({ postId: "post-1" });

    expect(result.ok).toBe(true);
  });
});

describe("aprobar y descartar una idea (F78)", () => {
  it("con content.approve aprueba la idea", async () => {
    customRole(["content.view", "content.create", "content.approve"]);

    const result = await approveIdea("idea-1");

    expect(result.ok).toBe(true);
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["approve_content_idea"]);
    expect(enqueueCopy).not.toHaveBeenCalled();
  });

  it("content.publish solo no alcanza para aprobar una idea", async () => {
    customRole(["content.view", "content.create", "content.publish"]);

    const result = await approveIdea("idea-1");

    expect(result.ok).toBe(false);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("'Aprobar y producir copy' sin content.ai se rechaza ANTES de aprobar", async () => {
    customRole(["content.view", "content.create", "content.approve"]);

    const result = await approveIdea("idea-1", { produceCopy: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/IA/);
    // No aprobar a medias: ni la idea cambio ni se creo la pieza.
    expect(db.rpcCalls).toHaveLength(0);
    expect(enqueueCopy).not.toHaveBeenCalled();
  });

  it("'Aprobar y producir copy' con content.ai aprueba y pide el copy", async () => {
    customRole(["content.view", "content.create", "content.approve", "content.ai"]);

    const result = await approveIdea("idea-1", { produceCopy: true });

    expect(result.ok).toBe(true);
    expect(enqueueCopy).toHaveBeenCalledTimes(1);
  });

  it("descartar una idea tambien pide content.approve", async () => {
    expect((await discardIdea("idea-1")).ok).toBe(false);

    customRole(["content.view", "content.create", "content.approve"]);
    expect((await discardIdea("idea-1")).ok).toBe(true);
  });
});
