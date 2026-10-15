import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { resolveStoryPiece } from "./story-piece";

const WS = "ws-1";
const seed = (posts: Array<Record<string, unknown>>) =>
  memoryDb({ social_posts: posts, content_posts: [{ id: "cp-1", workspace_id: WS, title: "Reel de dólares" }] });
const args = { workspaceId: WS, platform: "instagram", storyId: "story-1" };

describe("resolveStoryPiece", () => {
  it("una historia publicada por el sistema devuelve la publicación y la pieza", async () => {
    const db = seed([{ id: "sp-1", workspace_id: WS, platform: "instagram", external_post_id: "story-1", content_post_id: "cp-1", caption: "x", deleted_at: null }]);
    expect(await resolveStoryPiece(db.client, args)).toEqual({ socialPostId: "sp-1", contentPostId: "cp-1", title: "Reel de dólares" });
  });
  it("una historia marcada a mano sin pieza usa el caption", async () => {
    const db = seed([{ id: "sp-1", workspace_id: WS, platform: "instagram", external_post_id: "story-1", content_post_id: null, caption: "Historia del lunes\nmás texto", deleted_at: null }]);
    expect(await resolveStoryPiece(db.client, args)).toMatchObject({ contentPostId: null, title: "Historia del lunes" });
  });
  it("una historia desconocida, de otro workspace, de otra red o borrada no devuelve nada", async () => {
    const db = seed([
      { id: "a", workspace_id: "otro", platform: "instagram", external_post_id: "story-1", deleted_at: null },
      { id: "b", workspace_id: WS, platform: "tiktok", external_post_id: "story-1", deleted_at: null },
      { id: "c", workspace_id: WS, platform: "instagram", external_post_id: "story-1", deleted_at: "2026-10-01T00:00:00Z" },
    ]);
    expect(await resolveStoryPiece(db.client, args)).toBeNull();
  });
  it("si hay más de una fila para el mismo id, no adivina", async () => {
    const db = seed([
      { id: "a", workspace_id: WS, platform: "instagram", external_post_id: "story-1", deleted_at: null },
      { id: "b", workspace_id: WS, platform: "instagram", external_post_id: "story-1", deleted_at: null },
    ]);
    expect(await resolveStoryPiece(db.client, args)).toBeNull();
  });
  it("sin storyId, o con la base caída, devuelve null y no lanza", async () => {
    expect(await resolveStoryPiece(seed([]).client, { ...args, storyId: "  " })).toBeNull();
    const broken = { from: () => { throw new Error("caída"); } } as never;
    expect(await resolveStoryPiece(broken, args)).toBeNull();
  });
});
