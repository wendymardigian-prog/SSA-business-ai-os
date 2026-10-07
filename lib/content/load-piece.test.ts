/**
 * El cargador del drawer de la pieza (F96, F99).
 *
 * Lo que importa: devuelve null para algo que no se puede ver (y asi las rutas
 * viejas conservan su 404), no mezcla workspaces, y arma lo que el drawer
 * necesita sin que cada pantalla lo rearme distinto.
 */

import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import type { PermissionContext } from "@/lib/auth/guards";

vi.mock("@/lib/ai/provider", () => ({
  listConnectedAiProviders: async (_ws: string) => [{ provider: "anthropic", label: "Anthropic", defaultModel: "x", models: [] }],
}));
vi.mock("@/lib/workspace-members", () => ({
  getWorkspaceMembers: async () => [{ userId: "u1", name: "Ana", email: "w@x.test", role: "owner" }],
  memberLabels: () => new Map([["u1", "Ana"]]),
}));

const { loadPiece } = await import("./load-piece");

const WS = "ws-1";

function ctx(over: { keys?: string[]; db?: ReturnType<typeof memoryDb> } = {}) {
  const keys = over.keys ?? ["content.approve", "content.publish", "content.ai", "settings.manage"];
  const db =
    over.db ??
    memoryDb({
      content_posts: [
        {
          id: "post-1",
          workspace_id: WS,
          title: "Una pieza",
          format: "Reel",
          script: "Guion",
          recording_notes: "Notas",
          caption: "Caption",
          networks: [{ platform: "instagram", planned_at: null }],
          media: [{ storage_path: "ws-1/post-1/a.jpg", mime_type: "image/jpeg", kind: "image", size_bytes: 10 }],
          status: "in_review",
          ai_unreviewed: false,
          review_note: "Cambiá el gancho",
          created_by: "u1",
          created_at: "2026-10-01T15:00:00Z",
          updated_at: "2026-10-02T15:00:00Z",
          copy_status: "idle",
          idea_id: "idea-1",
          pillar_id: null,
          offer_id: null,
          funnel_stage: "mofu",
          reference: null,
        },
        { id: "ajena", workspace_id: "otro-ws", title: "Ajena", status: "draft", networks: [], media: [] },
      ],
      content_ideas: [{ id: "idea-1", workspace_id: WS, title: "La idea", content: "Texto de la idea" }],
      content_pillars: [],
      content_offers: [],
      social_posts: [
        { id: "sp-1", content_post_id: "post-1", platform: "instagram", status: "failed", scheduled_at: "2026-10-05T15:00:00Z", published_at: null, url: null, last_error: "Boom", last_error_kind: "temporary", attempts: 2, warning: null, actual_visibility: null, deleted_at: null },
        { id: "sp-2", content_post_id: "post-1", platform: "tiktok", status: "published", deleted_at: "2026-10-01T00:00:00Z" },
      ],
      social_accounts: [
        { workspace_id: WS, platform: "instagram", channel_id: "ch-1", username: "ana", publishers: [{ publisher: "zernio", status: "available" }, { publisher: "postproxy", status: "unavailable" }], default_publisher: "zernio", is_active: true },
      ],
      channels: [{ id: "ch-1", workspace_id: WS, platform: "instagram", is_active: true }],
      triggers: [],
      content_post_versions: [
        { id: "v1", post_id: "post-1", version_no: 1, snapshot: {}, author_kind: "human", author_id: "u1", reason: "manual_save", created_at: "2026-10-01T00:00:00Z" },
      ],
    });
  return {
    workspace: { id: WS, timezone: "America/Costa_Rica" },
    user: { id: "u1" },
    supabase: db.client,
    role: "admin",
    permissions: {},
    can: (key: string) => keys.includes(key),
    scope: () => "all",
  } as unknown as PermissionContext;
}

describe("loadPiece (F96)", () => {
  it("arma la pieza con el guion unico, la idea de origen y el motivo de la devolucion", async () => {
    const data = await loadPiece(ctx(), "post-1");

    expect(data).not.toBeNull();
    expect(data!.post).toMatchObject({
      id: "post-1",
      script: "Guion",
      recordingNotes: "Notas",
      funnelStage: "mofu",
      reviewNote: "Cambiá el gancho",
      idea: { id: "idea-1", title: "La idea", content: "Texto de la idea" },
    });
  });

  it("la autoria sale con el nombre y las fechas en la zona del negocio", async () => {
    const data = await loadPiece(ctx(), "post-1");

    expect(data!.post.authorship).toBe("Ana · creada el 1 oct · editada el 2 oct");
  });

  it("CRITERIO (F99): una pieza que no existe, o de otro workspace, es null", async () => {
    expect(await loadPiece(ctx(), "no-existe")).toBeNull();
    expect(await loadPiece(ctx(), "ajena")).toBeNull();
  });

  it("los permisos salen de las claves, no del cargo", async () => {
    const admin = await loadPiece(ctx(), "post-1");
    const sinNada = await loadPiece(ctx({ keys: [] }), "post-1");

    expect(admin!.perms).toMatchObject({ approve: true, publish: true, ai: true, isAuthor: true });
    expect(sinNada!.perms).toMatchObject({ approve: false, publish: false, ai: false });
  });

  it("las publicaciones traen el estado completo y no incluyen las dadas de baja", async () => {
    const data = await loadPiece(ctx(), "post-1");

    expect(data!.publications).toHaveLength(1);
    expect(data!.publications[0]).toMatchObject({ platform: "instagram", status: "failed", lastError: "Boom", attempts: 2 });
  });

  it("'Publicar por' solo ofrece lo disponible", async () => {
    const data = await loadPiece(ctx(), "post-1");

    expect(data!.publishersByPlatform.instagram).toEqual(["zernio"]);
  });

  it("el canal de cada red y las redes conectadas", async () => {
    const data = await loadPiece(ctx(), "post-1");

    expect(data!.connected).toEqual(["instagram"]);
    expect(data!.channelIdByPlatform).toEqual({ instagram: "ch-1" });
  });

  it("sin permiso de IA no pregunta por proveedores", async () => {
    expect((await loadPiece(ctx({ keys: [] }), "post-1"))!.aiAvailable).toBe(false);
    expect((await loadPiece(ctx(), "post-1"))!.aiAvailable).toBe(true);
  });

  it("trae el historial y el nombre de los autores", async () => {
    const data = await loadPiece(ctx(), "post-1");

    expect(data!.versions).toHaveLength(1);
    expect(data!.authorNames).toEqual({ u1: "Ana" });
  });

  it("el selector '+ Crear' lo habilita settings.manage", async () => {
    expect((await loadPiece(ctx(), "post-1"))!.taxonomy.canCreate).toBe(true);
    expect((await loadPiece(ctx({ keys: ["content.approve"] }), "post-1"))!.taxonomy.canCreate).toBe(false);
  });
});
