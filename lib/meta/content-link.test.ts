/**
 * F25: enlazar un anuncio con la publicacion (y la pieza) que promociona.
 */
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { candidateIds, linkAdsToContent, matchPost } from "./content-link";

const WS = "ws-1";
const ACC = "act_1";

const ad = (over: Record<string, unknown> = {}) => ({
  id: "row-1", workspace_id: WS, ad_account_id: ACC, ad_id: "a1",
  instagram_media_id: null, object_story_id: null,
  social_post_id: null, content_post_id: null, content_link_manual: false,
  ...over,
});

const post = (over: Record<string, unknown> = {}) => ({
  id: "sp-1", workspace_id: WS, platform: "instagram", external_post_id: "ig-1", content_post_id: "cp-1", ...over,
});

const run = (db: ReturnType<typeof memoryDb>, ids: Array<{ adId: string; instagramMediaId: string | null; objectStoryId: string | null }>) =>
  linkAdsToContent(db.client, { workspaceId: WS, adAccountId: ACC, ads: ids });

describe("matchPost", () => {
  it("coincide por el id de la publicacion de Instagram", () => {
    expect(matchPost({ adId: "a", instagramMediaId: "ig-1", objectStoryId: null }, [{ id: "sp-1", externalPostId: "ig-1", contentPostId: "cp-1" }])?.id).toBe("sp-1");
  });
  it("sin coincidencia o sin ids, null", () => {
    expect(matchPost({ adId: "a", instagramMediaId: "ig-9", objectStoryId: null }, [{ id: "sp-1", externalPostId: "ig-1", contentPostId: null }])).toBeNull();
    expect(matchPost({ adId: "a", instagramMediaId: null, objectStoryId: null }, [{ id: "sp-1", externalPostId: null, contentPostId: null }])).toBeNull();
  });
  it("junta los ids sin vacios ni repetidos", () => {
    expect(candidateIds({ adId: "a", instagramMediaId: "x", objectStoryId: "x" })).toEqual(["x"]);
  });
});

describe("linkAdsToContent", () => {
  it("completa social_post_id y content_post_id cuando el id coincide", async () => {
    const db = memoryDb({ meta_ads: [ad({ instagram_media_id: "ig-1" })], social_posts: [post()] });
    const linked = await run(db, [{ adId: "a1", instagramMediaId: "ig-1", objectStoryId: null }]);
    expect(linked).toBe(1);
    expect(db.rows("meta_ads")[0]).toMatchObject({ social_post_id: "sp-1", content_post_id: "cp-1" });
  });

  it("sin coincidencia no escribe nada (queda null)", async () => {
    const db = memoryDb({ meta_ads: [ad({ instagram_media_id: "ig-9" })], social_posts: [post()] });
    expect(await run(db, [{ adId: "a1", instagramMediaId: "ig-9", objectStoryId: null }])).toBe(0);
    expect(db.rows("meta_ads")[0]).toMatchObject({ social_post_id: null, content_post_id: null });
  });

  it("el vinculo automatico NO pisa uno manual", async () => {
    const db = memoryDb({
      meta_ads: [ad({ instagram_media_id: "ig-1", content_link_manual: true, social_post_id: "sp-manual", content_post_id: "cp-manual" })],
      social_posts: [post()],
    });
    expect(await run(db, [{ adId: "a1", instagramMediaId: "ig-1", objectStoryId: null }])).toBe(0);
    expect(db.rows("meta_ads")[0]).toMatchObject({ social_post_id: "sp-manual", content_post_id: "cp-manual" });
  });

  it("solo mira publicaciones de este workspace e Instagram", async () => {
    const db = memoryDb({
      meta_ads: [ad({ instagram_media_id: "ig-1" })],
      social_posts: [post({ workspace_id: "otro" }), post({ id: "sp-2", platform: "tiktok" })],
    });
    expect(await run(db, [{ adId: "a1", instagramMediaId: "ig-1", objectStoryId: null }])).toBe(0);
  });

  it("nunca lanza: un fallo de la base devuelve 0", async () => {
    const db = memoryDb({});
    (db.client as unknown as { from: unknown }).from = () => {
      throw new Error("base caida");
    };
    await expect(run(db, [{ adId: "a1", instagramMediaId: "ig-1", objectStoryId: null }])).resolves.toBe(0);
  });
});
