/**
 * Lo del Diseñador IA que `loadPiece` le da al drawer (DS8): quién puede diseñar o abrir, y los diseños de la pieza.
 * Lo demás de `loadPiece` lo cubre `load-piece.test.ts` (que no cambia).
 */

import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import type { PermissionContext } from "@/lib/auth/guards";

vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async () => "America/Argentina/Buenos_Aires" }));
vi.mock("@/lib/ai/provider", () => ({ listConnectedAiProviders: async () => [] }));
vi.mock("@/lib/workspace-members", () => ({
  getWorkspaceMembers: async () => [{ userId: "u1", name: "Ana", email: "ana@example.test", role: "owner" }],
  memberLabels: () => new Map([["u1", "Ana"]]),
}));

const { loadPiece } = await import("./load-piece");

const WS = "ws-1";
const ENTRY = (designId: string, n: number) => ({ id: `design-${designId}-${n}`, storage_path: `ws-1/post-1/design-${designId}-${n}.png`, mime_type: "image/png", kind: "image", size_bytes: 10, design_id: designId, design_page: n, design_version: 3 });

function ctx(over: { keys?: string[]; role?: string; createdBy?: string; designs?: Array<Record<string, unknown>> } = {}) {
  const keys = over.keys ?? ["designer.view", "designer.edit", "content.create"];
  const db = memoryDb({
    content_posts: [
      {
        id: "post-1",
        workspace_id: WS,
        title: "Una pieza",
        format: null,
        script: "Guion",
        recording_notes: null,
        caption: "Caption",
        networks: [{ platform: "instagram", planned_at: null, format: "carousel", files: [] }],
        media: [ENTRY("d1", 1), ENTRY("d1", 2), ENTRY("viejo", 1)],
        status: "draft",
        ai_unreviewed: false,
        review_note: null,
        created_by: over.createdBy ?? "u1",
        assigned_to: null,
        attribution_code: null,
        created_at: "2026-10-01T15:00:00Z",
        updated_at: "2026-10-02T15:00:00Z",
        copy_status: "idle",
        idea_id: null,
        pillar_id: null,
        offer_id: null,
        funnel_stage: null,
        reference: null,
      },
    ],
    content_pillars: [],
    products: [],
    social_posts: [],
    social_accounts: [],
    channels: [],
    triggers: [],
    content_post_versions: [],
    designs: over.designs ?? [
      { id: "d1", workspace_id: WS, name: "Carrusel", rev: 5, content_post_id: "post-1", content_network: "instagram", archived_at: null },
      { id: "viejo", workspace_id: WS, name: "Versión anterior", rev: 2, content_post_id: null, content_network: null, archived_at: null },
      { id: "ajeno", workspace_id: "otro", name: "De otro negocio", rev: 1, content_post_id: "post-1", content_network: "instagram", archived_at: null },
    ],
  });
  return {
    workspace: { id: WS, timezone: "America/Costa_Rica" },
    user: { id: "u1" },
    supabase: db.client,
    role: over.role ?? "member",
    permissions: {},
    can: (key: string) => keys.includes(key),
    scope: () => "all",
  } as unknown as PermissionContext;
}

describe("loadPiece → designer (DS8)", () => {
  it("un Member que escribió la pieza puede diseñar y abrir, y ve sus diseños (los vinculados y los de sus archivos)", async () => {
    const data = await loadPiece(ctx(), "post-1");

    expect(data?.designer).toMatchObject({ canDesign: true, canView: true });
    expect(data?.designer?.designs.map((d) => [d.id, d.linked, d.network, d.rev]).sort()).toEqual([
      ["d1", true, "instagram", 5],
      ["viejo", false, null, 2],
    ]);
  });

  it("no ve los diseños de otro negocio", async () => {
    const data = await loadPiece(ctx(), "post-1");

    expect(data?.designer?.designs.some((d) => d.id === "ajeno")).toBe(false);
  });

  it("CRITERIO: sin designer.edit o sin content.create, no puede diseñar (se oculta); ver sigue siendo ver", async () => {
    const noEdit = await loadPiece(ctx({ keys: ["designer.view", "content.create"] }), "post-1");
    const noCreate = await loadPiece(ctx({ keys: ["designer.view", "designer.edit"] }), "post-1");

    expect(noEdit?.designer).toMatchObject({ canDesign: false, canView: true });
    expect(noCreate?.designer).toMatchObject({ canDesign: false, canView: true });
  });

  it("una pieza que no puede escribir (de otra persona) tampoco se diseña", async () => {
    const data = await loadPiece(ctx({ createdBy: "otra-persona" }), "post-1");

    expect(data?.canEdit).toBe(false);
    expect(data?.designer?.canDesign).toBe(false);
  });

  it("un administrador diseña cualquier pieza", async () => {
    const data = await loadPiece(ctx({ role: "admin", createdBy: "otra-persona" }), "post-1");

    expect(data?.designer?.canDesign).toBe(true);
  });

  it("sin designer.view no se leen los diseños (la RLS no los dejaría ver) y no se puede abrir", async () => {
    const data = await loadPiece(ctx({ keys: ["content.create"] }), "post-1");

    expect(data?.designer).toEqual({ canDesign: false, canView: false, designs: [] });
  });

  it("una pieza sin diseños da una lista vacía", async () => {
    const data = await loadPiece(ctx({ designs: [] }), "post-1");

    expect(data?.designer?.designs).toEqual([]);
  });
});
