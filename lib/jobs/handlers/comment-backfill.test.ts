import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { handleCommentBackfill, handleCommentBackfillWorkspace } from "./comment-backfill";

const WS = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const SP = "33333333-3333-4333-8333-333333333333";
const touches: Array<Record<string, unknown>> = [];
let db: MemoryDb;

const comment = (id: string, over: Record<string, unknown> = {}) => ({
  id: `row-${id}`, workspace_id: WS, platform: "instagram", external_comment_id: id, author_username: "ana_perez", is_own: false, deleted_at: null, contact_id: null,
  commented_at: "2026-10-01T10:00:00.000Z", social_post_id: SP, ...over,
});
const world = (comments: Array<Record<string, unknown>>, contact: Record<string, unknown> = {}) => {
  touches.length = 0;
  db = memoryDb(
    {
      contacts: [{ id: C1, workspace_id: WS, instagram_username: "ana_perez", tiktok_username: null, deleted_at: null, ...contact }],
      social_post_comments: comments,
      social_posts: [], content_posts: [], scheduled_jobs: [],
    },
    { rpc: { record_contact_touch: (args) => (touches.push(args), { inserted: true }) } },
  );
};
const run = (payload: Record<string, unknown>, handler = handleCommentBackfill) => handler({ supabase: db.client, job: { id: "j", type: "x", payload, attempts: 0 } });

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

describe("comment_backfill", () => {
  it("vincula los comentarios viejos sin contacto y anota los toques con la fecha del comentario", async () => {
    world([comment("c-1"), comment("c-2", { commented_at: "2026-09-20T10:00:00.000Z" }), comment("c-3", { author_username: "ANA_PEREZ" })]);
    await run({ workspace_id: WS, contact_id: C1 });
    expect(db.rows("social_post_comments").every((c) => c.contact_id === C1)).toBe(true);
    expect(touches).toHaveLength(3);
    expect(touches.map((t) => (t.p_touch as Record<string, unknown>).dedupe_key).sort()).toEqual(["comment:c-1", "comment:c-2", "comment:c-3"]);
    expect((touches.find((t) => (t.p_touch as Record<string, unknown>).dedupe_key === "comment:c-2")!.p_touch as Record<string, unknown>).occurred_at).toBe("2026-09-20T10:00:00.000Z");
  });

  it("no toca los que ya tenían contacto, los propios, los borrados ni los de otro usuario (aunque `_` sea comodín)", async () => {
    world([
      comment("ya", { contact_id: "otro" }), comment("propio", { is_own: true }), comment("borrado", { deleted_at: "2026-10-02T00:00:00Z" }),
      comment("parecido", { author_username: "anaXperez" }), comment("otra-red", { platform: "tiktok" }),
    ]);
    await run({ workspace_id: WS, contact_id: C1 });
    const byId = Object.fromEntries(db.rows("social_post_comments").map((c) => [c.external_comment_id, c.contact_id]));
    expect(byId).toEqual({ ya: "otro", propio: null, borrado: null, parecido: null, "otra-red": null });
    expect(touches).toHaveLength(0);
  });

  it("correrlo dos veces no duplica toques (el segundo ya no encuentra comentarios sin contacto)", async () => {
    world([comment("c-1")]);
    await run({ workspace_id: WS, contact_id: C1 });
    await run({ workspace_id: WS, contact_id: C1 });
    expect(touches).toHaveLength(1);
  });

  it("un contacto borrado o inexistente no hace nada y no lanza", async () => {
    world([comment("c-1")], { deleted_at: "2026-10-02T00:00:00Z" });
    await expect(run({ workspace_id: WS, contact_id: C1 })).resolves.toBeUndefined();
    await expect(run({ workspace_id: WS, contact_id: "33333333-3333-4333-8333-333333333399" })).resolves.toBeUndefined();
    expect(touches).toHaveLength(0);
  });

  it("un payload roto se ignora", async () => {
    world([]);
    await expect(run({ workspace_id: "no", contact_id: null })).resolves.toBeUndefined();
  });

  it("si falla un toque, los demás comentarios se vinculan igual", async () => {
    world([comment("c-1"), comment("c-2")]);
    let n = 0;
    db = memoryDb(
      { contacts: db.rows("contacts"), social_post_comments: db.rows("social_post_comments"), social_posts: [], content_posts: [], scheduled_jobs: [] },
      { rpc: { record_contact_touch: () => { n += 1; if (n === 1) throw new Error("boom"); return { inserted: true }; } } },
    );
    await run({ workspace_id: WS, contact_id: C1 });
    expect(db.rows("social_post_comments").every((c) => c.contact_id === C1)).toBe(true);
  });
});

describe("comment_backfill_workspace", () => {
  it("encola un comment_backfill por cada contacto con usuario y no encola a los demás", async () => {
    world([]);
    db.rows("contacts").push({ id: "44444444-4444-4444-8444-444444444444", workspace_id: WS, instagram_username: null, tiktok_username: null, deleted_at: null });
    await run({ workspace_id: WS }, handleCommentBackfillWorkspace);
    const jobs = db.rows("scheduled_jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: "comment_backfill" });
    expect((jobs[0].payload as Record<string, unknown>).contact_id).toBe(C1);
  });
});
