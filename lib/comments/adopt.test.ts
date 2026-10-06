/**
 * F76: adoptar comentarios huérfanos.
 *
 * El caso real: 167 comentarios entraron por el webhook sin cuenta social, así
 * que ninguno quedó vinculado a una publicación. Con la cuenta ya creada y la
 * publicación sincronizada, esto los une por el id del post en la red.
 */
import { describe, it, expect } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { adoptOrphanComments } from "./adopt";
import { storeComment } from "./store";

const WS = "ws-1";

const comment = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  workspace_id: WS,
  platform: "instagram",
  external_comment_id: `c-${id}`,
  social_post_id: null,
  external_post_id: "ig-post-1",
  deleted_at: null,
  ...over,
});

const post = (id: string, externalPostId: string | null, over: Record<string, unknown> = {}) => ({
  id,
  workspace_id: WS,
  platform: "instagram",
  external_post_id: externalPostId,
  deleted_at: null,
  ...over,
});

describe("adoptOrphanComments (F76)", () => {
  it("vincula el comentario huérfano a la publicación que coincide", async () => {
    const db = memoryDb({
      social_post_comments: [comment("1"), comment("2")],
      social_posts: [post("sp-1", "ig-post-1")],
    });

    const result = await adoptOrphanComments(db.client as never, WS, "instagram");

    expect(result.adopted).toBe(2);
    expect(db.rows("social_post_comments").every((c) => c.social_post_id === "sp-1")).toBe(true);
  });

  it("correrla dos veces no cambia nada la segunda", async () => {
    const db = memoryDb({ social_post_comments: [comment("1")], social_posts: [post("sp-1", "ig-post-1")] });

    await adoptOrphanComments(db.client as never, WS, "instagram");
    const second = await adoptOrphanComments(db.client as never, WS, "instagram");

    expect(second.adopted).toBe(0);
    expect(db.rows("social_post_comments")[0].social_post_id).toBe("sp-1");
  });

  it("un comentario sin external_post_id se saltea sin error", async () => {
    const db = memoryDb({
      social_post_comments: [comment("1", { external_post_id: null })],
      social_posts: [post("sp-1", "ig-post-1")],
    });

    const result = await adoptOrphanComments(db.client as never, WS, "instagram");

    expect(result).toEqual({ adopted: 0, withoutPostId: 1, waiting: 0 });
    expect(db.rows("social_post_comments")[0].social_post_id).toBeNull();
  });

  it("si la publicación todavía no existe, espera y NO la crea", async () => {
    const db = memoryDb({ social_post_comments: [comment("1")], social_posts: [] });

    const result = await adoptOrphanComments(db.client as never, WS, "instagram");

    expect(result.waiting).toBe(1);
    expect(db.rows("social_posts")).toHaveLength(0);
    expect(db.rows("social_post_comments")[0].social_post_id).toBeNull();
  });

  it("no pisa un comentario que ya tenía publicación", async () => {
    const db = memoryDb({
      social_post_comments: [comment("1", { social_post_id: "sp-otro" })],
      social_posts: [post("sp-1", "ig-post-1")],
    });

    await adoptOrphanComments(db.client as never, WS, "instagram");

    expect(db.rows("social_post_comments")[0].social_post_id).toBe("sp-otro");
  });

  it("no mezcla plataformas ni workspaces", async () => {
    const db = memoryDb({
      social_post_comments: [
        comment("1", { platform: "tiktok" }),
        comment("2", { workspace_id: "ws-otro" }),
      ],
      social_posts: [post("sp-1", "ig-post-1")],
    });

    const result = await adoptOrphanComments(db.client as never, WS, "instagram");

    expect(result.adopted).toBe(0);
  });
});

describe("storeComment y el id del post en la red (F76)", () => {
  const incoming = {
    platform: "instagram",
    externalCommentId: "c-1",
    externalPostId: "ig-post-1",
    isOwn: false,
    text: "SISTEMA",
    commentedAt: "2026-10-03T12:00:00Z",
    source: "webhook" as const,
  };

  it("sin cuenta social lo guarda huérfano pero CON el id del post", async () => {
    const db = memoryDb({ social_post_comments: [] });

    await storeComment(db.client as never, { workspaceId: WS, socialAccountId: null, comment: incoming });

    const row = db.rows("social_post_comments")[0];
    expect(row.social_post_id ?? null).toBeNull();
    expect(row.external_post_id).toBe("ig-post-1");
  });

  it("una relectura que no logra resolver la publicación NO desvincula el comentario", async () => {
    const db = memoryDb({
      social_post_comments: [comment("1", { external_comment_id: "c-1", social_post_id: "sp-1" })],
    });

    await storeComment(db.client as never, {
      workspaceId: WS,
      socialAccountId: null,
      comment: { ...incoming, source: "sync" },
    });

    expect(db.rows("social_post_comments")[0].social_post_id).toBe("sp-1");
  });
});
