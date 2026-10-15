import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { linkCommentToContact } from "./link-to-contact";

const WS = "ws-1";
const touches: Array<Record<string, unknown>> = [];

const world = (contactId: string | null) => {
  touches.length = 0;
  return memoryDb(
    {
      social_post_comments: [{ id: "row-1", workspace_id: WS, platform: "instagram", external_comment_id: "c-1", contact_id: contactId }],
      social_posts: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", workspace_id: WS, content_post_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", caption: "Reel de dólares" }],
      content_posts: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", workspace_id: WS, title: "Cómo cobrar en dólares" }],
    },
    { rpc: { record_contact_touch: (args) => (touches.push(args), { inserted: true }) } },
  );
};
const comment = { platform: "instagram", externalCommentId: "c-1", commentedAt: "2026-10-01T10:00:00Z", socialPostId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe("linkCommentToContact", () => {
  it("vincula el comentario y anota el toque con la fecha del comentario y la pieza", async () => {
    const db = world(null);
    const r = await linkCommentToContact(db.client, { workspaceId: WS, contactId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", comment });
    expect(r).toEqual({ linked: true, touched: true });
    expect(db.rows("social_post_comments")[0].contact_id).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(touches[0].p_touch).toMatchObject({ origin: "comment", medium: "comment", dedupe_key: "comment:c-1", occurred_at: "2026-10-01T10:00:00.000Z", content_post_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", social_post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", content: "Cómo cobrar en dólares" });
  });

  it("con onlyIfUnlinked, un comentario que ya tenía contacto NO cambia ni anota nada", async () => {
    const db = world("otro-contacto");
    const r = await linkCommentToContact(db.client, { workspaceId: WS, contactId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", comment: { ...comment, onlyIfUnlinked: true } });
    expect(r).toEqual({ linked: false, touched: false });
    expect(db.rows("social_post_comments")[0].contact_id).toBe("otro-contacto");
    expect(touches).toHaveLength(0);
  });

  it("nunca lanza, aunque la base se caiga", async () => {
    const db = memoryDb({ social_post_comments: [], social_posts: [] }, { rpc: { record_contact_touch: () => { throw new Error("caída"); } } });
    await expect(linkCommentToContact(db.client, { workspaceId: WS, contactId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", comment })).resolves.toMatchObject({ touched: false });
  });
});
